-- =============================================================================
-- 16_notificacoes_sprint13.sql
-- Sprint 13 - Fase 6 (Automacao): M17 - Notificacoes e Automacao
-- (RF-119 a RF-125).
--
-- Executar como gestao_owner, depois de 01 a 15:
--   psql -U gestao_owner -h localhost -d gestao_empresarial -f 16_notificacoes_sprint13.sql
-- Idempotente: pode ser reexecutado.
--
-- O que 03 ja entregava: as tabelas `notificacao`, `regra_automacao` e
-- `regra_automacao_execucao`, os enums de canal e status e a RLS por empresa.
-- Este script fecha o que faltava para o aviso ser confiavel:
--   1.  RN-001 - referencias presas a mesma empresa
--   2.  RF-119 - destinatario obrigatoriamente da empresa
--   3.  RF-121 a RF-124 - idempotencia do aviso (chave_dedupe)
--   4.  RF-119/RF-120 - maquina de estados da notificacao
--   5.  RF-119 - dominio dos campos (prioridade, canal, tentativas)
--   6.  RF-120 - fila de envio: indice parcial do que esta PENDENTE
--   7.  RF-125 - forma das regras de automacao e trilha das execucoes
--   8.  RN-010 - notificacao e execucao nao se apagam; texto nao se reescreve
--   9.  RF-120 - catalogo: provedores de e-mail
--   10. RN-001/RN-002 - RLS revalidada
--
-- Decisao estrutural desta sprint: **notificar nao e agir**. A automacao da
-- RF-125 automatiza o aviso, nunca a decisao -- nenhuma regra prorroga parcela,
-- cancela ordem ou concilia movimento. Uma regra que agisse sozinha faria de um
-- erro de configuracao dinheiro saindo, sem ninguem no caminho.
--
-- Segunda decisao: o aviso e idempotente. Sem `chave_dedupe`, cada varredura
-- reavisaria a mesma parcela vencendo, e quinze avisos iguais por dia treinam o
-- destinatario a ignorar todos -- inclusive o unico que importava.
-- =============================================================================
SET search_path = gestao, public;

-- -----------------------------------------------------------------------------
-- 1. RN-001: referencia cruzada entre empresas
--
-- Mesma tecnica de 06 a 15: chave candidata (empresa_id, id) no destino e FK
-- composta na origem. Sem ela, a execucao registrada pela empresa A poderia
-- apontar para a regra da empresa B informando o id dela.
--
-- `notificacao.usuario_id` fica de fora: `usuario` e identidade global e nao
-- tem empresa_id -- o vinculo com a empresa e `usuario_empresa`, e por isso o
-- destinatario e validado por trigger (secao 2), nao por FK.
-- -----------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['regra_automacao','notificacao'] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_constraint
                        WHERE conrelid = format('gestao.%I', t)::regclass
                          AND conname  = format('uq_%s_tenant', t)) THEN
            EXECUTE format(
                'ALTER TABLE gestao.%1$I ADD CONSTRAINT uq_%1$s_tenant UNIQUE (empresa_id, id);', t);
        END IF;
    END LOOP;
END $$;

DO $$
DECLARE c record;
BEGIN
    FOR c IN
        SELECT con.conname
          FROM pg_constraint con
         WHERE con.conrelid = 'gestao.regra_automacao_execucao'::regclass
           AND con.contype = 'f'
           AND con.conkey = ARRAY[(SELECT a.attnum FROM pg_attribute a
                                    WHERE a.attrelid = con.conrelid
                                      AND a.attname = 'regra_automacao_id')]
    LOOP
        EXECUTE format('ALTER TABLE gestao.regra_automacao_execucao DROP CONSTRAINT %I;', c.conname);
    END LOOP;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.regra_automacao_execucao'::regclass
                      AND conname  = 'fk_regra_automacao_execucao_regra_tenant') THEN
        ALTER TABLE gestao.regra_automacao_execucao
            ADD CONSTRAINT fk_regra_automacao_execucao_regra_tenant
            FOREIGN KEY (empresa_id, regra_automacao_id)
            REFERENCES gestao.regra_automacao (empresa_id, id) ON DELETE CASCADE;
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. RF-119: o destinatario e da empresa que notifica
--
-- A RLS garante que a linha pertence a empresa; nao garante que o usuario
-- apontado por `usuario_id` tenha acesso a ela. Sem esta checagem, um aviso
-- enderecado ao id de um usuario de outra empresa entregaria a ele o titulo, o
-- valor e o parceiro no corpo da mensagem -- vazamento por enderecamento, sem
-- nenhuma consulta cruzada envolvida.
--
-- `usuario_id` nulo continua valendo: e o aviso da empresa, lido por quem tem a
-- permissao do assunto (a API resolve os destinatarios).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_notificacao_valida_destinatario() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.usuario_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM gestao.usuario_empresa ue
                        WHERE ue.usuario_id = NEW.usuario_id
                          AND ue.empresa_id = NEW.empresa_id
                          AND ue.ativo) THEN
        RAISE EXCEPTION 'RF-119: destinatario % nao esta associado a empresa %',
            NEW.usuario_id, NEW.empresa_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_notificacao_valida_destinatario() IS
    'RF-119/RN-001 - notificacao so e enderecada a usuario com associacao ativa na empresa.';

DROP TRIGGER IF EXISTS trg_notificacao_destinatario ON notificacao;
CREATE TRIGGER trg_notificacao_destinatario
    BEFORE INSERT OR UPDATE OF usuario_id, empresa_id ON notificacao
    FOR EACH ROW EXECUTE FUNCTION fn_notificacao_valida_destinatario();

-- -----------------------------------------------------------------------------
-- 3. RF-121 a RF-124: idempotencia do aviso
--
-- A varredura roda a cada poucos minutos e reencontra os mesmos fatos: a mesma
-- parcela vencendo amanha, a mesma aprovacao parada, a mesma divergencia. A
-- chave descreve o fato, nao a rodada -- "VENCIMENTO:<parcela>:<vencimento>" --
-- e o indice e o unico lugar onde duas varreduras simultaneas se encontram.
--
-- CANCELADA fica fora do indice de proposito: cancelar um aviso e a maneira de
-- permitir que ele seja emitido de novo quando o fato voltar a merecer atencao.
-- -----------------------------------------------------------------------------
ALTER TABLE notificacao ADD COLUMN IF NOT EXISTS chave_dedupe varchar(200);

COMMENT ON COLUMN notificacao.chave_dedupe IS
    'RF-121..124 - identifica o FATO avisado. Duas varreduras do mesmo fato geram um aviso so.';

CREATE UNIQUE INDEX IF NOT EXISTS ux_notificacao_dedupe
    ON notificacao (empresa_id, chave_dedupe)
    WHERE chave_dedupe IS NOT NULL AND status <> 'CANCELADA';

-- -----------------------------------------------------------------------------
-- 4. RF-119/RF-120: maquina de estados
--
--   PENDENTE  -> ENVIADA | FALHA | CANCELADA
--   ENVIADA   -> LIDA | CANCELADA
--   FALHA     -> PENDENTE (reenvio) | CANCELADA
--   LIDA / CANCELADA sao finais.
--
-- Sem isto, um envio concorrente poderia marcar como ENVIADA algo ja LIDA (e
-- apagar a data de leitura), e um reenvio poderia devolver a fila um aviso que
-- o destinatario ja viu.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_notificacao_transicao() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF NOT (
            (OLD.status = 'PENDENTE' AND NEW.status IN ('ENVIADA','FALHA','CANCELADA')) OR
            (OLD.status = 'ENVIADA'  AND NEW.status IN ('LIDA','CANCELADA')) OR
            (OLD.status = 'FALHA'    AND NEW.status IN ('PENDENTE','CANCELADA'))
        ) THEN
            RAISE EXCEPTION 'RF-119: transicao invalida de % para %', OLD.status, NEW.status
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    IF NEW.status IN ('ENVIADA','LIDA') AND NEW.enviada_em IS NULL THEN
        NEW.enviada_em := now();
    END IF;
    IF NEW.status = 'LIDA' AND NEW.lida_em IS NULL THEN
        NEW.lida_em := now();
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_notificacao_transicao() IS
    'RF-119/RF-120 - maquina de estados da notificacao; carimba enviada_em e lida_em.';

DROP TRIGGER IF EXISTS trg_notificacao_transicao ON notificacao;
CREATE TRIGGER trg_notificacao_transicao
    BEFORE UPDATE ON notificacao
    FOR EACH ROW EXECUTE FUNCTION fn_notificacao_transicao();

-- -----------------------------------------------------------------------------
-- 5. RF-119: dominio dos campos
--
-- A prioridade ordena a caixa de entrada: fora de 1..5 ela nao ordena nada. E
-- canal EMAIL sem endereco e um aviso que nunca sai e ninguem procura -- o
-- envio falharia no adaptador, longe de quem configurou a regra.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.notificacao'::regclass
                      AND conname = 'ck_notificacao_prioridade') THEN
        ALTER TABLE notificacao ADD CONSTRAINT ck_notificacao_prioridade
            CHECK (prioridade BETWEEN 1 AND 5);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.notificacao'::regclass
                      AND conname = 'ck_notificacao_tentativas') THEN
        ALTER TABLE notificacao ADD CONSTRAINT ck_notificacao_tentativas
            CHECK (tentativas >= 0 AND tentativas <= 50);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.notificacao'::regclass
                      AND conname = 'ck_notificacao_email') THEN
        ALTER TABLE notificacao ADD CONSTRAINT ck_notificacao_email
            CHECK (canal <> 'EMAIL' OR destinatario_email IS NOT NULL);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.notificacao'::regclass
                      AND conname = 'ck_notificacao_leitura') THEN
        ALTER TABLE notificacao ADD CONSTRAINT ck_notificacao_leitura
            CHECK (status <> 'LIDA' OR (lida_em IS NOT NULL AND usuario_id IS NOT NULL));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.notificacao'::regclass
                      AND conname = 'ck_notificacao_texto') THEN
        ALTER TABLE notificacao ADD CONSTRAINT ck_notificacao_texto
            CHECK (btrim(titulo) <> '' AND btrim(mensagem) <> '' AND btrim(tipo) <> '');
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 6. RF-120: fila de envio
--
-- O despacho procura sempre a mesma coisa: o que ainda nao saiu. Indice
-- parcial, e nao indice cheio: a tabela cresce com tudo o que ja foi entregue,
-- e nenhuma varredura precisa desse historico.
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS ix_notificacao_pendente
    ON notificacao (empresa_id, criado_em)
    WHERE status = 'PENDENTE';

CREATE INDEX IF NOT EXISTS ix_notificacao_entidade
    ON notificacao (empresa_id, entidade, entidade_id);

-- -----------------------------------------------------------------------------
-- 7. RF-125: forma das regras de automacao
--
-- `acoes` vazio e uma regra que casa com os fatos e nao faz nada: pior do que
-- nao existir, porque aparece na tela como cobertura que nao existe. E o evento
-- e fechado no CHECK porque o motor so sabe avaliar estes -- uma regra com
-- gatilho desconhecido nunca dispara, e ninguem descobre isso olhando a lista.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.regra_automacao'::regclass
                      AND conname = 'ck_regra_automacao_evento') THEN
        ALTER TABLE regra_automacao ADD CONSTRAINT ck_regra_automacao_evento
            CHECK (evento_gatilho IN (
                'TITULO_VENCENDO','PAGAMENTO_PROCESSADO','PAGAMENTO_FALHOU',
                'APROVACAO_PENDENTE','DIVERGENCIA_CONCILIACAO'));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.regra_automacao'::regclass
                      AND conname = 'ck_regra_automacao_acoes') THEN
        ALTER TABLE regra_automacao ADD CONSTRAINT ck_regra_automacao_acoes
            CHECK (jsonb_typeof(acoes) = 'array' AND jsonb_array_length(acoes) > 0);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.regra_automacao'::regclass
                      AND conname = 'ck_regra_automacao_condicoes') THEN
        ALTER TABLE regra_automacao ADD CONSTRAINT ck_regra_automacao_condicoes
            CHECK (jsonb_typeof(condicoes) = 'object');
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_regra_automacao_evento
    ON regra_automacao (empresa_id, evento_gatilho) WHERE ativo;

CREATE INDEX IF NOT EXISTS ix_regra_automacao_execucao
    ON regra_automacao_execucao (empresa_id, regra_automacao_id, executado_em DESC);

DROP TRIGGER IF EXISTS trg_regra_automacao_atualizado_em ON regra_automacao;
CREATE TRIGGER trg_regra_automacao_atualizado_em
    BEFORE UPDATE ON regra_automacao
    FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();

-- RN-010: a regra entra na lista de entidades auditadas por DML, ao lado de
-- `alcada` e `perfil_permissao` -- e pelo mesmo motivo. Quem passa a ser
-- avisado, e quem deixa de ser, e decisao de governanca: sem a trilha, nao ha
-- como responder quem desligou o alerta de pagamento falho, nem quando.
--
-- A `notificacao` fica de fora de proposito: e a tabela de maior volume do
-- sistema, cada linha ja e o proprio registro do que foi comunicado, e auditar
-- INSERT de aviso dobraria o volume da trilha sem responder pergunta nenhuma.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
                    WHERE tgrelid = 'gestao.regra_automacao'::regclass
                      AND tgname = 'trg_regra_automacao_auditoria') THEN
        CREATE TRIGGER trg_regra_automacao_auditoria
            AFTER INSERT OR UPDATE OR DELETE ON gestao.regra_automacao
            FOR EACH ROW EXECUTE FUNCTION gestao.fn_auditoria_generica();
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 8. RN-010: o aviso e a execucao nao se apagam, e o texto nao se reescreve
--
-- "Por que ninguem foi avisado?" so tem resposta se o registro de que se avisou
-- -- ou nao -- continuar la. E reescrever titulo, mensagem ou tipo depois de
-- enviado faria a caixa de entrada divergir do que chegou por e-mail, sem
-- deixar rastro de qual dos dois e o original.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_notificacao_imutavel() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'RN-010: notificacao nao e removida; cancele-a (status CANCELADA)'
            USING ERRCODE = 'restrict_violation';
    END IF;

    IF NEW.tipo IS DISTINCT FROM OLD.tipo
       OR NEW.titulo IS DISTINCT FROM OLD.titulo
       OR NEW.mensagem IS DISTINCT FROM OLD.mensagem
       OR NEW.entidade IS DISTINCT FROM OLD.entidade
       OR NEW.entidade_id IS DISTINCT FROM OLD.entidade_id
       OR NEW.criado_em IS DISTINCT FROM OLD.criado_em THEN
        RAISE EXCEPTION 'RN-010: o conteudo da notificacao e imutavel'
            USING ERRCODE = 'restrict_violation';
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_notificacao_imutavel() IS
    'RN-010 - notificacao nao se apaga e o texto enviado nao se reescreve.';

DROP TRIGGER IF EXISTS trg_notificacao_imutavel ON notificacao;
CREATE TRIGGER trg_notificacao_imutavel
    BEFORE UPDATE OR DELETE ON notificacao
    FOR EACH ROW EXECUTE FUNCTION fn_notificacao_imutavel();

CREATE OR REPLACE FUNCTION fn_regra_execucao_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'RN-010: a trilha de execucao da automacao e append-only'
        USING ERRCODE = 'restrict_violation';
END;
$$;

COMMENT ON FUNCTION fn_regra_execucao_append_only() IS
    'RN-010 - a execucao registrada da automacao nao se altera nem se apaga.';

DROP TRIGGER IF EXISTS trg_regra_execucao_append_only ON regra_automacao_execucao;
CREATE TRIGGER trg_regra_execucao_append_only
    BEFORE UPDATE OR DELETE ON regra_automacao_execucao
    FOR EACH ROW EXECUTE FUNCTION fn_regra_execucao_append_only();

-- -----------------------------------------------------------------------------
-- 9. RF-120: catalogo de provedores de e-mail
--
-- `EMAIL_LOG` e o adaptador da empresa que ainda nao contratou envio: a
-- notificacao interna continua funcionando e o e-mail fica registrado como
-- tentativa, em vez de o modulo inteiro recusar operar. `EMAIL_GENERICO` e o
-- adaptador HTTP para qualquer servico REST de envio.
-- -----------------------------------------------------------------------------
INSERT INTO provider (codigo, nome, categoria, descricao, capacidades) VALUES
 ('EMAIL_LOG','Sem envio de e-mail (somente registro)','EMAIL',
  'Nenhum e-mail sai: o aviso fica na caixa interna e a tentativa e registrada (RF-119).',
  '{"email":false,"anexos":false}'),
 ('EMAIL_GENERICO','Servico de e-mail HTTP','EMAIL',
  'Adaptador HTTP generico para servicos REST de envio de e-mail (RF-120).',
  '{"email":true,"anexos":false}')
ON CONFLICT (codigo) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 10. RN-001 / RN-002: RLS revalidada
--
-- As tres tabelas ganharam restricoes e triggers neste script. A politica
-- generica de 03 continua correta (empresa_id NOT NULL), mas recria-la aqui
-- garante que uma reexecucao parcial de 03, ou uma tabela restaurada de backup,
-- nao a deixe sem politica -- e sem politica, com FORCE RLS, a tabela nao
-- responde, o que aparece como "bug de consulta" em vez de falha de isolamento.
--
-- O recorte por destinatario (aviso pessoal x aviso da empresa) NAO esta aqui:
-- e a API que o aplica, porque depende do usuario autenticado da requisicao e
-- nao do tenant. A RLS garante o limite que importa -- nenhuma empresa alcanca
-- a notificacao de outra, com qualquer id na URL.
-- -----------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['notificacao','regra_automacao','regra_automacao_execucao'] LOOP
        EXECUTE format('ALTER TABLE gestao.%I ENABLE ROW LEVEL SECURITY;', t);
        EXECUTE format('ALTER TABLE gestao.%I FORCE ROW LEVEL SECURITY;', t);
        EXECUTE format('DROP POLICY IF EXISTS pol_%1$s_tenant ON gestao.%1$I;', t);
        EXECUTE format(
            'CREATE POLICY pol_%1$s_tenant ON gestao.%1$I
             USING (empresa_id = gestao.fn_empresa_corrente())
             WITH CHECK (empresa_id = gestao.fn_empresa_corrente());', t);
    END LOOP;
END $$;

-- =============================================================================
-- FIM - 16_notificacoes_sprint13.sql
-- =============================================================================
