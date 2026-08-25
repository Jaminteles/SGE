-- =============================================================================
-- 15_ocr_sprint12.sql
-- Sprint 12 - Fase 6 (Automacao): M13 - OCR e Automacao de Documentos
-- (RF-095 a RF-100).
--
-- Executar como gestao_owner, depois de 01 a 14:
--   psql -U gestao_owner -h localhost -d gestao_empresarial -f 15_ocr_sprint12.sql
-- Idempotente: pode ser reexecutado.
--
-- O que 03 ja entregava: a tabela `ocr_processamento`, o enum `enum_status_ocr`,
-- o provider `OCR_GENERICO` e a RLS por empresa. Este script fecha o que faltava
-- para o resultado do OCR ser confiavel e preservavel:
--   1.  RN-001 - referencias presas a mesma empresa (FK composta)
--   2.  RF-095 - um processamento por documento, e documento que nao se apaga
--   3.  RF-096/RF-097 - dominio dos campos extraidos e da confianca
--   4.  RF-096 - maquina de estados do processamento
--   5.  RF-099 - validacao humana: quem validou, quando, e o que corrigiu
--   6.  RF-100 - texto e payload do provedor sao imutaveis depois de extraidos
--   7.  RF-100 - o processamento nao se apaga
--   8.  RN-010 - auditoria e atualizado_em
--   9.  RF-096 - catalogo: provedor manual, para a empresa sem OCR contratado
--   10. RN-001/RN-002 - RLS revalidada
--
-- Decisao estrutural desta sprint: **OCR nao lanca nada**. O processamento
-- produz uma leitura com confianca e sugestoes; quem cria titulo, reembolso ou
-- documento fiscal continua sendo M08, M03 e M07, a partir de uma decisao
-- humana (RF-099). Um OCR que lancasse sozinho transformaria erro de leitura em
-- dinheiro movimentado, e a "sugestao" da RF-098 deixaria de ser sugestao.
--
-- Segunda decisao: o resultado bruto do provedor e imutavel. Correcao humana
-- entra em `correcoes` (jsonb), ao lado do que foi lido -- nunca por cima. Sem
-- isso nao ha como responder, depois, se o valor errado veio do OCR ou de quem
-- validou, que e a unica pergunta que importa quando o lancamento sai errado.
-- =============================================================================
SET search_path = gestao, public;

-- -----------------------------------------------------------------------------
-- 1. RN-001: referencia cruzada entre empresas
--
-- Mesma tecnica de 06 a 14: chave candidata (empresa_id, id) no destino e FK
-- composta (empresa_id, <coluna>) na origem. Sem a empresa na chave, a empresa A
-- poderia sugerir para o proprio documento a categoria, o centro de custo ou o
-- parceiro da empresa B informando o id deles -- e a resposta 200 confirmaria
-- que aquele id existe.
-- -----------------------------------------------------------------------------
-- 1.1 Chave candidata (empresa_id, id) nas tabelas referenciadas aqui.
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'documento','categoria_financeira','centro_custo','parceiro','ocr_processamento'
    ] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_constraint
                        WHERE conrelid = format('gestao.%I', t)::regclass
                          AND conname  = format('uq_%s_tenant', t)) THEN
            EXECUTE format(
                'ALTER TABLE gestao.%1$I ADD CONSTRAINT uq_%1$s_tenant UNIQUE (empresa_id, id);', t);
        END IF;
    END LOOP;
END $$;

-- 1.2 Troca das FKs de coluna unica por FKs compostas com empresa_id.
--
-- `documento_id` deixa de ser CASCADE e passa a RESTRICT: RF-100 pede que o
-- documento e o resultado sejam preservados, e CASCADE faria o resultado sumir
-- junto com o arquivo. As sugestoes viram RESTRICT pelo mesmo motivo de sempre
-- (o PostgreSQL 14 nao aceita SET NULL em FK composta): inativar categoria e o
-- caminho, apagar nao e.
DO $$
DECLARE
    r record;
    c record;
BEGIN
    FOR r IN
        SELECT * FROM (VALUES
            ('ocr_processamento', 'documento_id',             'documento',            'RESTRICT'),
            ('ocr_processamento', 'categoria_sugerida_id',    'categoria_financeira', 'RESTRICT'),
            ('ocr_processamento', 'centro_custo_sugerido_id', 'centro_custo',         'RESTRICT'),
            ('ocr_processamento', 'parceiro_sugerido_id',     'parceiro',             'RESTRICT')
        ) AS t(tabela, coluna, referencia, acao)
    LOOP
        FOR c IN
            SELECT con.conname
              FROM pg_constraint con
             WHERE con.conrelid = format('gestao.%I', r.tabela)::regclass
               AND con.contype = 'f'
               AND con.conkey = ARRAY[(SELECT a.attnum FROM pg_attribute a
                                        WHERE a.attrelid = con.conrelid
                                          AND a.attname = r.coluna)]
        LOOP
            EXECUTE format('ALTER TABLE gestao.%I DROP CONSTRAINT %I;', r.tabela, c.conname);
        END LOOP;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint
                        WHERE conrelid = format('gestao.%I', r.tabela)::regclass
                          AND conname  = format('fk_%s_%s_tenant', r.tabela, r.coluna)) THEN
            EXECUTE format(
                'ALTER TABLE gestao.%1$I ADD CONSTRAINT fk_%1$s_%2$s_tenant
                 FOREIGN KEY (empresa_id, %2$I) REFERENCES gestao.%3$I (empresa_id, id)
                 ON DELETE %4$s;', r.tabela, r.coluna, r.referencia, r.acao);
        END IF;
    END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 2. RF-095: um processamento por documento
--
-- O mesmo arquivo enviado duas vezes -- retry do cliente, duplo clique, reenvio
-- depois de timeout -- nao pode virar dois processamentos: seriam duas leituras
-- do mesmo comprovante, duas sugestoes e, mais adiante, dois lancamentos
-- candidatos para a mesma despesa. A unicidade fica no banco porque e o unico
-- lugar onde duas requisicoes simultaneas se encontram.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.ocr_processamento'::regclass
                      AND conname = 'uq_ocr_documento') THEN
        ALTER TABLE gestao.ocr_processamento
            ADD CONSTRAINT uq_ocr_documento UNIQUE (empresa_id, documento_id);
    END IF;
END $$;

-- A fila de trabalho e a de revisao sao as duas consultas quentes do modulo, e
-- as duas olham para um punhado de linhas dentro de um historico que so cresce.
CREATE INDEX IF NOT EXISTS ix_ocr_pendente
    ON gestao.ocr_processamento (empresa_id, criado_em)
    WHERE status IN ('PENDENTE','PROCESSANDO','ERRO');

CREATE INDEX IF NOT EXISTS ix_ocr_revisao
    ON gestao.ocr_processamento (empresa_id, criado_em)
    WHERE status = 'PROCESSADO';

-- -----------------------------------------------------------------------------
-- 3. RF-096/RF-097: dominio do que foi lido
--
-- Confianca fora de 0..100 e valor negativo nao sao "dado ruim do provedor":
-- sao dado que a interface exibiria como leitura valida. A chave de 44 digitos
-- e o CNPJ/CPF seguem o criterio dos dominios de 01 -- so digitos, e no
-- comprimento certo, porque e assim que eles serao comparados com `parceiro`.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.ocr_processamento'::regclass
                      AND conname = 'ck_ocr_confianca') THEN
        ALTER TABLE gestao.ocr_processamento ADD CONSTRAINT ck_ocr_confianca
            CHECK (confianca_geral IS NULL OR confianca_geral BETWEEN 0 AND 100);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.ocr_processamento'::regclass
                      AND conname = 'ck_ocr_valor') THEN
        ALTER TABLE gestao.ocr_processamento ADD CONSTRAINT ck_ocr_valor
            CHECK (valor_extraido IS NULL OR valor_extraido >= 0);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.ocr_processamento'::regclass
                      AND conname = 'ck_ocr_tentativas') THEN
        ALTER TABLE gestao.ocr_processamento ADD CONSTRAINT ck_ocr_tentativas
            CHECK (tentativas BETWEEN 0 AND 20);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.ocr_processamento'::regclass
                      AND conname = 'ck_ocr_chave_documento') THEN
        ALTER TABLE gestao.ocr_processamento ADD CONSTRAINT ck_ocr_chave_documento
            CHECK (chave_documento IS NULL OR chave_documento ~ '^[0-9]{44}$');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.ocr_processamento'::regclass
                      AND conname = 'ck_ocr_estabelecimento_documento') THEN
        ALTER TABLE gestao.ocr_processamento ADD CONSTRAINT ck_ocr_estabelecimento_documento
            CHECK (estabelecimento_documento IS NULL
                   OR estabelecimento_documento ~ '^[0-9]{11}$'
                   OR estabelecimento_documento ~ '^[0-9]{14}$');
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 4. RF-096: maquina de estados
--
-- PENDENTE -> PROCESSANDO -> PROCESSADO | ERRO
-- PROCESSADO -> VALIDADO | REJEITADO        (RF-099, decisao humana)
-- ERRO -> PENDENTE                          (reprocessamento)
--
-- VALIDADO e REJEITADO sao terminais: depois que alguem assumiu a leitura, ela
-- nao volta para a fila -- voltaria com outro texto, e a decisao registrada
-- passaria a se referir a um resultado que nao existe mais.
--
-- ERRO exige mensagem, e PROCESSADO exige que algo tenha sido lido: um
-- "processado" sem texto e sem campo extraido e uma falha silenciosa, e e ela
-- que faz a fila de revisao encher de linhas vazias.
--
-- A excecao e o provedor que nao le (`capacidades->>'automatico' = false`): ali
-- o resultado vazio e o resultado correto, e o documento vai para a digitacao
-- humana (RF-099). A distincao vem do catalogo, e nao de um campo escrito pela
-- aplicacao, porque quem grava o resultado nao pode ser quem decide se ele vale.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_valida_status_ocr() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_permitido boolean := false;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'PENDENTE' THEN
            RAISE EXCEPTION 'Processamento de OCR nasce PENDENTE (RF-095).';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.status = OLD.status THEN
        v_permitido := true;
    ELSE
        v_permitido := (OLD.status, NEW.status) IN (
            ('PENDENTE','PROCESSANDO'),
            ('PROCESSANDO','PROCESSADO'),
            ('PROCESSANDO','ERRO'),
            ('PROCESSANDO','PENDENTE'),
            ('ERRO','PENDENTE'),
            ('PROCESSADO','VALIDADO'),
            ('PROCESSADO','REJEITADO')
        );
    END IF;

    IF NOT v_permitido THEN
        RAISE EXCEPTION 'Transicao de OCR invalida: % -> % (RF-096/RF-099).',
            OLD.status, NEW.status;
    END IF;

    IF NEW.status = 'ERRO' AND coalesce(btrim(NEW.erro), '') = '' THEN
        RAISE EXCEPTION 'Processamento em ERRO precisa registrar a causa (RF-096).';
    END IF;

    IF NEW.status = 'PROCESSADO'
       AND coalesce(btrim(NEW.texto_extraido), '') = ''
       AND NEW.valor_extraido IS NULL
       AND NEW.data_extraida IS NULL
       AND NEW.chave_documento IS NULL
       AND coalesce(
             (SELECT (p.capacidades->>'automatico')::boolean
                FROM gestao.provider p WHERE p.id = NEW.provider_id),
             true) THEN
        RAISE EXCEPTION 'Processamento sem nada extraido e ERRO, nao PROCESSADO (RF-096/RF-097).';
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_valida_status_ocr() IS
    'RF-096/RF-099 - transicoes validas do processamento de OCR.';

DROP TRIGGER IF EXISTS trg_valida_status_ocr ON ocr_processamento;
CREATE TRIGGER trg_valida_status_ocr
    BEFORE INSERT OR UPDATE ON ocr_processamento
    FOR EACH ROW EXECUTE FUNCTION fn_valida_status_ocr();

-- -----------------------------------------------------------------------------
-- 5. RF-099: validacao humana
--
-- Quem validou e quando sao parte do resultado, nao metadado opcional: sao a
-- assinatura da pessoa que assumiu a leitura da maquina. Um VALIDADO sem autor
-- nao serve para nada -- e e exatamente o registro que se procura quando o
-- lancamento derivado dele sai errado.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.ocr_processamento'::regclass
                      AND conname = 'ck_ocr_validacao') THEN
        ALTER TABLE gestao.ocr_processamento ADD CONSTRAINT ck_ocr_validacao
            CHECK (
                (status IN ('VALIDADO','REJEITADO')
                    AND validado_por IS NOT NULL AND validado_em IS NOT NULL)
             OR (status NOT IN ('VALIDADO','REJEITADO')
                    AND validado_por IS NULL AND validado_em IS NULL)
            );
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 6. RF-100: o que o provedor leu nao se reescreve
--
-- Depois de PROCESSADO, `texto_extraido` e `payload_bruto` sao historia: a
-- correcao humana entra em `correcoes`, ao lado. Sem essa separacao nao ha como
-- responder se o valor errado veio da maquina ou de quem revisou -- e essa e a
-- unica pergunta util depois que o lancamento sai errado.
--
-- O vinculo com a empresa e com o documento tambem congela: mover um resultado
-- de documento seria trocar a evidencia por baixo de uma leitura ja revisada.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_preserva_resultado_ocr() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.empresa_id IS DISTINCT FROM OLD.empresa_id
       OR NEW.documento_id IS DISTINCT FROM OLD.documento_id THEN
        RAISE EXCEPTION 'O documento de origem do OCR nao muda (RF-100).';
    END IF;

    IF OLD.status IN ('PROCESSADO','VALIDADO','REJEITADO') THEN
        IF NEW.texto_extraido IS DISTINCT FROM OLD.texto_extraido
           OR NEW.payload_bruto IS DISTINCT FROM OLD.payload_bruto THEN
            RAISE EXCEPTION
                'Texto e payload do OCR sao imutaveis depois de extraidos; use correcoes (RF-100).';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_preserva_resultado_ocr() IS
    'RF-100 - preserva documento de origem, texto e payload do provedor.';

DROP TRIGGER IF EXISTS trg_preserva_resultado_ocr ON ocr_processamento;
CREATE TRIGGER trg_preserva_resultado_ocr
    BEFORE UPDATE ON ocr_processamento
    FOR EACH ROW EXECUTE FUNCTION fn_preserva_resultado_ocr();

-- -----------------------------------------------------------------------------
-- 7. RF-100: o processamento nao se apaga
--
-- Rejeitar e uma decisao registrada (status REJEITADO), nao um DELETE. Um
-- resultado que some leva junto a prova de que o documento foi lido, o que a
-- maquina leu e quem discordou.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_bloqueia_delete_ocr() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION
        'Processamento de OCR nao e removido: use REJEITADO (RF-099/RF-100).';
END;
$$;

DROP TRIGGER IF EXISTS trg_ocr_sem_delete ON ocr_processamento;
CREATE TRIGGER trg_ocr_sem_delete
    BEFORE DELETE ON ocr_processamento
    FOR EACH ROW EXECUTE FUNCTION fn_bloqueia_delete_ocr();

REVOKE DELETE ON ocr_processamento FROM app_gestao;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sge_api') THEN
        REVOKE DELETE ON gestao.ocr_processamento FROM sge_api;
    END IF;
END $$;

COMMENT ON TABLE ocr_processamento IS
    'RF-095 a RF-100 - leitura automatica de comprovante: resultado, sugestoes e validacao humana; append-only.';

-- -----------------------------------------------------------------------------
-- 8. RN-010: auditoria e atualizado_em
--
-- O processamento decide o que sera sugerido a quem lanca a despesa, e a
-- validacao humana e uma aprovacao com efeito financeiro adiante. As duas
-- precisam de trilha.
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_ocr_processamento_auditoria ON ocr_processamento;
CREATE TRIGGER trg_ocr_processamento_auditoria
    AFTER INSERT OR UPDATE OR DELETE ON ocr_processamento
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria_generica();

DROP TRIGGER IF EXISTS trg_ocr_processamento_atualizado_em ON ocr_processamento;
CREATE TRIGGER trg_ocr_processamento_atualizado_em
    BEFORE UPDATE ON ocr_processamento
    FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();

-- -----------------------------------------------------------------------------
-- 9. RF-096: catalogo de provedores de OCR
--
-- `OCR_GENERICO` (03) e o adaptador HTTP. Falta o caso mais comum no comeco: a
-- empresa que ainda nao contratou OCR nenhum. Para ela o processamento entra na
-- fila, o adaptador manual devolve "sem leitura automatica" e o documento cai
-- direto na revisao humana -- que e o fluxo de RF-099 sem a maquina na frente.
-- -----------------------------------------------------------------------------
INSERT INTO provider (codigo, nome, categoria, descricao, capacidades) VALUES
 ('OCR_MANUAL','Digitacao manual (sem OCR)','OCR',
  'Sem leitura automatica: o documento vai direto para a validacao humana (RF-099).',
  '{"pdf":true,"imagem":true,"automatico":false}')
ON CONFLICT (codigo) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 10. RN-001 / RN-002: RLS revalidada
--
-- A tabela ganhou restricoes e triggers neste script. A politica generica de 03
-- continua correta (empresa_id NOT NULL), mas recria-la aqui garante que uma
-- reexecucao parcial de 03, ou uma tabela restaurada de backup, nao a deixe sem
-- politica -- e sem politica, com FORCE RLS, a tabela nao responde, o que
-- aparece como "bug de consulta" em vez de falha de isolamento.
-- -----------------------------------------------------------------------------
ALTER TABLE gestao.ocr_processamento ENABLE ROW LEVEL SECURITY;
ALTER TABLE gestao.ocr_processamento FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_ocr_processamento_tenant ON gestao.ocr_processamento;
CREATE POLICY pol_ocr_processamento_tenant ON gestao.ocr_processamento
    USING (empresa_id = gestao.fn_empresa_corrente())
    WITH CHECK (empresa_id = gestao.fn_empresa_corrente());

-- =============================================================================
-- FIM - 15_ocr_sprint12.sql
-- =============================================================================
