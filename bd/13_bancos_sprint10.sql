-- =============================================================================
-- 13_bancos_sprint10.sql
-- Sprint 10 - Fase 5 (Bancario): M09 - Bancos, Pagamentos e Recebimentos
-- (RF-059 a RF-070).
--
-- Executar como gestao_owner, depois de 01 a 12:
--   psql -U gestao_owner -h localhost -d gestao_empresarial -f 13_bancos_sprint10.sql
-- Idempotente: pode ser reexecutado.
--
-- O que 02/03 ja entregavam: as tabelas (provider, credencial_integracao,
-- conta_bancaria, idempotencia, transacao_pagamento, webhook_evento,
-- job_execucao, extrato_importacao, transacao_bancaria), a RLS por empresa, a
-- auditoria de conta_bancaria/transacao_pagamento/credencial_integracao e os
-- indices unicos de idempotency_key e de identificador externo. Este script
-- fecha o que faltava para o modulo mover dinheiro sem duplicar:
--   1.  RN-001 - referencias presas a mesma empresa (FK composta)
--   2.  RN-010 - trilha de auditoria no que ainda nao tinha
--   3.  RF-059 - conta bancaria: uma conta padrao, saldo coerente, conta que
--                paga e conta que recebe
--   4.  RF-067 - idempotencia como registro imutavel, com escopo e validade
--   5.  RF-062 a RF-065 / RF-068 - maquina de estados da transacao, o que
--                congela depois do envio e o cancelamento so onde ele existe
--   6.  RN-004 - uma transacao confirmada produz no maximo uma baixa
--   7.  RF-066 / RN-005 - webhook deduplicado tambem quando o provedor nao
--                manda id de evento
--   8.  RF-069 / RF-070 / RN-011 - fila com dedupe de enfileiramento, tentativas
--                que nao retrocedem e proxima tentativa explicita
--   9.  RF-060 - extrato: periodo coerente, saldo da conta e dedupe do arquivo
--   10. RN-001/RN-002 - RLS estrita onde empresa_id e nulavel
--
-- Decisao estrutural desta sprint: **o dinheiro sai uma vez so, e quem garante
-- isso e o modelo**. Um pagamento tem tres chaves de unicidade empilhadas -- a
-- idempotency_key do cliente (por empresa), o identificador externo do provedor
-- e a baixa unica por transacao. Um retry da API, um reenvio do worker e um
-- webhook repetido batem, cada um, numa delas. A aplicacao repete essas mesmas
-- checagens para responder 409 com mensagem de dominio em vez de 500 de
-- violacao de integridade; o banco e que decide.
--
-- Segunda decisao: `conta_bancaria.saldo_atual` e o saldo **do banco**, nao um
-- saldo contabil nosso. Ele so muda por extrato importado (RF-060). Somar baixas
-- aqui criaria uma segunda fonte de verdade para o mesmo numero -- e a
-- divergencia entre o que lancamos e o que o banco diz e justamente o que a
-- conciliacao (M10, Sprint 11) precisa enxergar.
-- =============================================================================
SET search_path = gestao, public;

-- -----------------------------------------------------------------------------
-- 1. RN-001: referencia cruzada entre empresas
--
-- Mesma tecnica de 06 a 12: chave candidata (empresa_id, id) no destino e FK
-- composta (empresa_id, <coluna>) na origem. A verificacao de FK roda no
-- sistema, sem RLS -- sem a coluna de empresa na chave, a empresa A poderia
-- pagar debitando a conta bancaria da empresa B informando o id dela.
--
-- `provider` e `credencial_integracao` ficam de fora da regra por motivos
-- opostos: provider e catalogo global (nao tem empresa_id), e credencial ja
-- nasce por empresa -- para ela basta a FK composta na conta.
-- -----------------------------------------------------------------------------
-- 1.1 Chave candidata (empresa_id, id) nas tabelas referenciadas aqui.
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'conta_bancaria','credencial_integracao','transacao_pagamento',
        'extrato_importacao','transacao_bancaria'
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
-- Como nas sprints anteriores, `ON DELETE SET NULL` vira `RESTRICT`: o
-- PostgreSQL 14 nao aceita SET NULL em FK composta. E o comportamento correto
-- aqui -- uma baixa nao pode perder em silencio a conta de onde o dinheiro saiu.
DO $$
DECLARE
    r record;
    c record;
BEGIN
    FOR r IN
        SELECT * FROM (VALUES
            ('conta_bancaria',      'filial_id',              'filial',                'RESTRICT'),
            ('conta_bancaria',      'credencial_id',          'credencial_integracao', 'RESTRICT'),
            ('transacao_pagamento', 'conta_bancaria_id',      'conta_bancaria',        'RESTRICT'),
            ('transacao_pagamento', 'titulo_parcela_id',      'titulo_parcela',        'RESTRICT'),
            ('transacao_pagamento', 'estorno_de_id',          'transacao_pagamento',   'RESTRICT'),
            ('titulo_baixa',        'conta_bancaria_id',      'conta_bancaria',        'RESTRICT'),
            ('titulo_baixa',        'transacao_pagamento_id', 'transacao_pagamento',   'RESTRICT'),
            ('extrato_importacao',  'conta_bancaria_id',      'conta_bancaria',        'RESTRICT'),
            ('transacao_bancaria',  'conta_bancaria_id',      'conta_bancaria',        'RESTRICT'),
            ('transacao_bancaria',  'extrato_importacao_id',  'extrato_importacao',    'RESTRICT')
        ) AS t(tabela, coluna, referencia, acao)
    LOOP
        -- Remove a FK de coluna unica herdada de 02 (nome gerado pelo servidor).
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
-- 2. RN-010: auditoria do que ainda nao tinha
--
-- conta_bancaria, transacao_pagamento e credencial_integracao ja sao auditadas
-- desde 03. Faltavam o extrato e a transacao bancaria: e por eles que o saldo da
-- conta se move, e um extrato reimportado ou removido precisa deixar rastro.
-- -----------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['extrato_importacao','transacao_bancaria'] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_auditoria ON gestao.%1$I;', t);
        EXECUTE format(
            'CREATE TRIGGER trg_%1$s_auditoria
             AFTER INSERT OR UPDATE OR DELETE ON gestao.%1$I
             FOR EACH ROW EXECUTE FUNCTION gestao.fn_auditoria_generica();', t);
    END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 3. RF-059: a conta bancaria da empresa
--
-- Tres regras, e nenhuma delas e cosmetica:
--
--   3.1 uma conta padrao por empresa -- "padrao" que aponta para duas contas nao
--       e padrao, e a escolha silenciosa de qual delas paga seria feita pela
--       ordenacao da consulta;
--   3.2 conta inativa nao e padrao e nao paga nem recebe;
--   3.3 chave PIX so em conta que recebe/paga por PIX, e conta de pagamento
--       precisa de agencia e conta ou de chave PIX -- os mesmos dados sem os
--       quais nada e creditado (mesma regra de dado_bancario, bd/06 e bd/07).
-- -----------------------------------------------------------------------------
ALTER TABLE conta_bancaria ADD COLUMN IF NOT EXISTS observacao text;

COMMENT ON COLUMN conta_bancaria.saldo_atual IS
    'RF-060 - saldo informado pelo banco no ultimo extrato importado; nao e saldo contabil.';
COMMENT ON COLUMN conta_bancaria.data_saldo IS
    'RF-060 - data a que o saldo_atual se refere.';

CREATE UNIQUE INDEX IF NOT EXISTS ux_conta_bancaria_padrao
    ON conta_bancaria (empresa_id) WHERE padrao AND ativo;

CREATE OR REPLACE FUNCTION fn_valida_conta_bancaria() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NOT NEW.ativo THEN
        -- Conta encerrada nao continua sendo a conta padrao da empresa.
        NEW.padrao := false;
        NEW.permite_pagamento := false;
        NEW.permite_recebimento := false;
    END IF;

    IF NEW.permite_pagamento
       AND coalesce(NEW.agencia, '') = ''
       AND coalesce(NEW.chave_pix, '') = '' THEN
        RAISE EXCEPTION
            'A conta % nao tem agencia/conta nem chave PIX e por isso nao pode pagar (RF-059).',
            NEW.descricao;
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_valida_conta_bancaria() IS
    'RF-059 - conta inativa nao paga nem e padrao; conta que paga precisa de destino.';

DROP TRIGGER IF EXISTS trg_valida_conta_bancaria ON conta_bancaria;
CREATE TRIGGER trg_valida_conta_bancaria
    BEFORE INSERT OR UPDATE ON conta_bancaria
    FOR EACH ROW EXECUTE FUNCTION fn_valida_conta_bancaria();

-- -----------------------------------------------------------------------------
-- 4. RF-067: idempotencia e um registro imutavel
--
-- A tabela ja existia com a chave unica (escopo, chave). O que faltava e o que
-- torna a idempotencia confiavel: a linha nao se reescreve. Se o mesmo escopo e
-- a mesma chave pudessem apontar depois para outro recurso, a segunda chamada
-- passaria a devolver o resultado de uma operacao diferente da primeira -- que e
-- exatamente o contrario do que a chave promete.
--
-- A unica coluna que ainda muda e o par (recurso_id, resposta, status_http), e
-- so enquanto ainda esta vazio: a reserva e feita antes de executar, e o
-- resultado e gravado quando a operacao termina.
--
-- `escopo` fica preso a uma lista porque e ele que separa os espacos de chave:
-- o cliente escolhe a chave, e chaves iguais em escopos diferentes sao
-- operacoes diferentes.
-- -----------------------------------------------------------------------------
ALTER TABLE idempotencia ADD COLUMN IF NOT EXISTS usuario_id uuid REFERENCES usuario(id) ON DELETE SET NULL;
ALTER TABLE idempotencia ALTER COLUMN expira_em SET DEFAULT now() + interval '24 hours';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.idempotencia'::regclass
                      AND conname = 'ck_idempotencia_escopo') THEN
        ALTER TABLE gestao.idempotencia ADD CONSTRAINT ck_idempotencia_escopo
            CHECK (escopo IN ('PAGAMENTO','CANCELAMENTO','WEBHOOK','IMPORTACAO','JOB'));
    END IF;
END $$;

-- A chave e por empresa: duas empresas podem usar "pagamento-1" sem colidir.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint
                WHERE conrelid = 'gestao.idempotencia'::regclass
                  AND conname = 'uq_idempotencia') THEN
        ALTER TABLE gestao.idempotencia DROP CONSTRAINT uq_idempotencia;
    END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS ux_idempotencia_empresa_escopo_chave
    ON idempotencia (coalesce(empresa_id, '00000000-0000-0000-0000-000000000000'::uuid), escopo, chave);

CREATE OR REPLACE FUNCTION fn_protege_idempotencia() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        -- Expurgo do que ja venceu e permitido; apagar reserva viva nao e.
        IF OLD.expira_em IS NOT NULL AND OLD.expira_em <= now() THEN
            RETURN OLD;
        END IF;
        RAISE EXCEPTION
            'Reserva de idempotencia %/% ainda vigente nao pode ser removida (RF-067).',
            OLD.escopo, OLD.chave;
    END IF;

    IF (NEW.escopo, NEW.chave, NEW.empresa_id, NEW.request_hash)
       IS DISTINCT FROM (OLD.escopo, OLD.chave, OLD.empresa_id, OLD.request_hash) THEN
        RAISE EXCEPTION
            'A chave de idempotencia %/% nao se reescreve (RF-067).', OLD.escopo, OLD.chave;
    END IF;

    IF OLD.recurso_id IS NOT NULL AND NEW.recurso_id IS DISTINCT FROM OLD.recurso_id THEN
        RAISE EXCEPTION
            'A chave de idempotencia %/% ja aponta para o recurso % (RN-004).',
            OLD.escopo, OLD.chave, OLD.recurso_id;
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_protege_idempotencia() IS
    'RF-067 - a reserva nao muda de dono: so o resultado ainda vazio pode ser preenchido.';

DROP TRIGGER IF EXISTS trg_protege_idempotencia ON idempotencia;
CREATE TRIGGER trg_protege_idempotencia
    BEFORE UPDATE OR DELETE ON idempotencia
    FOR EACH ROW EXECUTE FUNCTION fn_protege_idempotencia();

-- -----------------------------------------------------------------------------
-- 5. RF-062 a RF-065 / RF-068: a maquina de estados da transacao
--
-- O caminho feliz e CRIADA -> ENFILEIRADA -> ENVIADA -> CONFIRMADA. A ordem
-- agendada (RF-063) espera em AGENDADA ate a data e vai direto para ENVIADA:
-- ela nao passa por ENFILEIRADA porque quem a segura e a propria fila, com
-- `agendado_para` -- e o worker so escreve na transacao depois de o provedor
-- responder, para que uma falha de rede nao deixe estado pela metade.
-- PROCESSANDO existe entre envio e confirmacao quando o provedor trabalha em
-- lote. FALHA volta para a fila enquanto houver tentativa (RF-070). CONFIRMADA
-- so vai para ESTORNADA. CANCELADA, ESTORNADA e EXPIRADA sao terminais.
--
-- O que congela, e por que: valor, conta de origem, sentido, metodo e
-- idempotency_key nunca mudam -- sao a identidade do pagamento, e a chave de
-- idempotencia so vale se o que ela identifica for sempre a mesma operacao.
-- Os dados do favorecido congelam no envio: depois que a ordem saiu, alterar
-- para quem ela foi seria reescrever a historia do dinheiro.
--
-- RF-065: cancelar so onde o provedor cancela. `cancelavel` e preenchido a
-- partir das capacidades do provider, e o banco recusa o cancelamento de quem
-- nao e cancelavel -- nao adianta a API achar que da.
-- -----------------------------------------------------------------------------
ALTER TABLE transacao_pagamento ADD COLUMN IF NOT EXISTS motivo_cancelamento text;
ALTER TABLE transacao_pagamento ADD COLUMN IF NOT EXISTS descricao varchar(255);

COMMENT ON COLUMN transacao_pagamento.identificador_externo IS
    'RF-068 - id da operacao no provedor; unico por provider (ux_transacao_externa).';
COMMENT ON COLUMN transacao_pagamento.end_to_end_id IS
    'RF-068 - E2E do PIX, quando o metodo o produz.';

-- RF-068 + RN-002: o identificador externo e unico **por empresa**.
--
-- O indice de 02 nao tinha empresa_id, e isso vaza tenant: o identificador que
-- a empresa A registrou passava a ser inutilizavel pela empresa B no mesmo
-- provedor -- e a colisao ainda revelava, pela mensagem de erro, que aquele
-- identificador ja existia em algum lugar. Com provedor real o id e global e a
-- diferenca nao aparece; com lancamento manual, em que o numero do comprovante
-- e digitado por uma pessoa, aparece no primeiro dia de uso.
DROP INDEX IF EXISTS ux_transacao_externa;
CREATE UNIQUE INDEX IF NOT EXISTS ux_transacao_externa
    ON transacao_pagamento (empresa_id, provider_id, identificador_externo)
    WHERE identificador_externo IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_transacao_parcela
    ON transacao_pagamento (titulo_parcela_id) WHERE titulo_parcela_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_transacao_retry
    ON transacao_pagamento (proxima_tentativa_em)
    WHERE status IN ('ENFILEIRADA','FALHA');

CREATE OR REPLACE FUNCTION fn_valida_transacao_pagamento() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_conta record;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status NOT IN ('CRIADA','AGENDADA') THEN
            RAISE EXCEPTION
                'Uma transacao nasce em CRIADA ou AGENDADA, nunca em % (RF-062).', NEW.status;
        END IF;
    ELSE
        IF (NEW.empresa_id, NEW.conta_bancaria_id, NEW.valor, NEW.sentido,
            NEW.metodo, NEW.idempotency_key)
           IS DISTINCT FROM
           (OLD.empresa_id, OLD.conta_bancaria_id, OLD.valor, OLD.sentido,
            OLD.metodo, OLD.idempotency_key) THEN
            RAISE EXCEPTION
                'Valor, conta, sentido, metodo e chave de idempotencia da transacao % nao mudam (RN-004).',
                OLD.id;
        END IF;

        IF NEW.status <> OLD.status THEN
            IF OLD.status IN ('CANCELADA','ESTORNADA','EXPIRADA') THEN
                RAISE EXCEPTION
                    'A transacao % esta % e nao muda mais de situacao (RF-064).', OLD.id, OLD.status;
            END IF;
            IF NOT (
                (OLD.status = 'CRIADA'      AND NEW.status IN ('AGENDADA','ENFILEIRADA','CANCELADA'))
             OR (OLD.status = 'AGENDADA'    AND NEW.status IN ('ENFILEIRADA','ENVIADA','FALHA','CANCELADA','EXPIRADA'))
             OR (OLD.status = 'ENFILEIRADA' AND NEW.status IN ('ENVIADA','FALHA','CANCELADA'))
             OR (OLD.status = 'ENVIADA'     AND NEW.status IN ('PROCESSANDO','CONFIRMADA','FALHA','CANCELADA','EXPIRADA'))
             OR (OLD.status = 'PROCESSANDO' AND NEW.status IN ('CONFIRMADA','FALHA','CANCELADA','EXPIRADA'))
             OR (OLD.status = 'FALHA'       AND NEW.status IN ('ENFILEIRADA','CANCELADA','EXPIRADA'))
             OR (OLD.status = 'CONFIRMADA'  AND NEW.status = 'ESTORNADA')
            ) THEN
                RAISE EXCEPTION 'Transicao invalida da transacao %: % -> % (RF-064).',
                    OLD.id, OLD.status, NEW.status;
            END IF;
        END IF;

        -- Depois de sair, a ordem nao muda de destinatario.
        IF OLD.status NOT IN ('CRIADA','AGENDADA','ENFILEIRADA')
           AND (NEW.favorecido_nome, NEW.favorecido_documento, NEW.favorecido_banco,
                NEW.favorecido_agencia, NEW.favorecido_conta, NEW.chave_pix, NEW.codigo_barras)
               IS DISTINCT FROM
               (OLD.favorecido_nome, OLD.favorecido_documento, OLD.favorecido_banco,
                OLD.favorecido_agencia, OLD.favorecido_conta, OLD.chave_pix, OLD.codigo_barras) THEN
            RAISE EXCEPTION
                'O favorecido da transacao % nao muda depois do envio (RF-064).', OLD.id;
        END IF;

        IF NEW.tentativas < OLD.tentativas THEN
            RAISE EXCEPTION 'O contador de tentativas da transacao % nao retrocede (RF-070).', OLD.id;
        END IF;

        IF OLD.identificador_externo IS NOT NULL
           AND NEW.identificador_externo IS DISTINCT FROM OLD.identificador_externo THEN
            RAISE EXCEPTION
                'O identificador externo da transacao % ja foi registrado e nao muda (RF-068).', OLD.id;
        END IF;

        IF NEW.status = 'CANCELADA' AND OLD.status NOT IN ('CRIADA','AGENDADA')
           AND NOT OLD.cancelavel THEN
            RAISE EXCEPTION
                'O provedor da transacao % nao suporta cancelamento apos o envio (RF-065).', OLD.id;
        END IF;
    END IF;

    IF NEW.tentativas > NEW.max_tentativas THEN
        RAISE EXCEPTION 'A transacao % excedeu o limite de % tentativas (RF-070).',
            NEW.id, NEW.max_tentativas;
    END IF;

    -- A conta debitada precisa poder pagar (e creditada, receber) -- RF-059.
    SELECT ativo, permite_pagamento, permite_recebimento
      INTO v_conta
      FROM conta_bancaria
     WHERE id = NEW.conta_bancaria_id;
    IF v_conta IS NULL OR NOT v_conta.ativo THEN
        RAISE EXCEPTION 'A conta bancaria da transacao % esta inativa (RF-059).', NEW.id;
    END IF;
    IF NEW.sentido = 'DEBITO' AND NOT v_conta.permite_pagamento THEN
        RAISE EXCEPTION 'A conta bancaria informada nao esta habilitada para pagamento (RF-059).';
    END IF;
    IF NEW.sentido = 'CREDITO' AND NOT v_conta.permite_recebimento THEN
        RAISE EXCEPTION 'A conta bancaria informada nao esta habilitada para recebimento (RF-059).';
    END IF;

    -- Consequencias do status, escritas aqui para nao dependerem do chamador.
    IF NEW.status = 'AGENDADA' THEN
        IF NEW.data_agendamento IS NULL THEN
            RAISE EXCEPTION 'Pagamento agendado exige data de agendamento (RF-063).';
        END IF;
        IF TG_OP = 'INSERT' AND NEW.data_agendamento < current_date THEN
            RAISE EXCEPTION 'A data de agendamento % ja passou (RF-063).', NEW.data_agendamento;
        END IF;
    ELSIF NEW.status = 'ENVIADA' THEN
        NEW.data_execucao := coalesce(NEW.data_execucao, now());
    ELSIF NEW.status = 'CONFIRMADA' THEN
        NEW.data_confirmacao := coalesce(NEW.data_confirmacao, now());
        NEW.codigo_erro := NULL;
        NEW.mensagem_erro := NULL;
        NEW.proxima_tentativa_em := NULL;
    ELSIF NEW.status = 'FALHA' THEN
        IF coalesce(NEW.codigo_erro, '') = '' AND coalesce(NEW.mensagem_erro, '') = '' THEN
            RAISE EXCEPTION 'Transacao % em FALHA exige codigo ou mensagem de erro (RF-070).', NEW.id;
        END IF;
    ELSIF NEW.status = 'CANCELADA' THEN
        NEW.cancelada_em := coalesce(NEW.cancelada_em, now());
        NEW.proxima_tentativa_em := NULL;
        IF coalesce(NEW.motivo_cancelamento, '') = '' THEN
            RAISE EXCEPTION 'O cancelamento da transacao % exige motivo (RF-065).', NEW.id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_valida_transacao_pagamento() IS
    'RF-062 a RF-065/RF-068/RF-070 - transicoes, imutabilidade da ordem e limite de tentativas.';

DROP TRIGGER IF EXISTS trg_valida_transacao_pagamento ON transacao_pagamento;
CREATE TRIGGER trg_valida_transacao_pagamento
    BEFORE INSERT OR UPDATE ON transacao_pagamento
    FOR EACH ROW EXECUTE FUNCTION fn_valida_transacao_pagamento();

-- Transacao de pagamento nao se apaga: ela e o registro de uma ordem enviada.
CREATE OR REPLACE FUNCTION fn_bloqueia_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Registros de % nao sao removidos: cancele ou estorne (RN-009).', TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS trg_transacao_pagamento_sem_delete ON transacao_pagamento;
CREATE TRIGGER trg_transacao_pagamento_sem_delete
    BEFORE DELETE ON transacao_pagamento
    FOR EACH ROW EXECUTE FUNCTION fn_bloqueia_delete();

-- -----------------------------------------------------------------------------
-- 6. RN-004: uma transacao confirmada produz no maximo uma baixa
--
-- Este e o indice que impede o pagamento duplicado de sobreviver a um retry do
-- worker ou a um webhook repetido. O estorno fica de fora: ele e a baixa espelho
-- da mesma transacao (bd/09) e precisa poder existir ao lado da original.
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS ux_baixa_transacao_pagamento
    ON titulo_baixa (transacao_pagamento_id)
    WHERE transacao_pagamento_id IS NOT NULL AND estorno_de_id IS NULL;

-- A parcela liquidada por transacao so aceita a baixa daquela transacao se as
-- duas apontarem para a mesma parcela -- caso contrario o dinheiro sairia por
-- um titulo e abateria outro.
CREATE OR REPLACE FUNCTION fn_valida_baixa_transacao() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_tx record;
BEGIN
    IF NEW.transacao_pagamento_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT titulo_parcela_id, status, valor, conta_bancaria_id
      INTO v_tx
      FROM transacao_pagamento
     WHERE id = NEW.transacao_pagamento_id;

    IF v_tx IS NULL THEN
        RAISE EXCEPTION 'Transacao de pagamento % nao encontrada.', NEW.transacao_pagamento_id;
    END IF;
    IF v_tx.status <> 'CONFIRMADA' THEN
        RAISE EXCEPTION
            'A transacao % esta % e ainda nao liquida parcela alguma (RN-004).',
            NEW.transacao_pagamento_id, v_tx.status;
    END IF;
    IF v_tx.titulo_parcela_id IS NOT NULL
       AND v_tx.titulo_parcela_id <> NEW.titulo_parcela_id THEN
        RAISE EXCEPTION
            'A transacao % foi emitida para outra parcela (RN-004).', NEW.transacao_pagamento_id;
    END IF;
    IF NEW.conta_bancaria_id IS NOT NULL
       AND NEW.conta_bancaria_id <> v_tx.conta_bancaria_id THEN
        RAISE EXCEPTION
            'A baixa aponta para conta diferente da usada na transacao % (RF-059).',
            NEW.transacao_pagamento_id;
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_valida_baixa_transacao() IS
    'RN-004 - a baixa originada de transacao segue a parcela, a conta e a confirmacao dela.';

DROP TRIGGER IF EXISTS trg_valida_baixa_transacao ON titulo_baixa;
CREATE TRIGGER trg_valida_baixa_transacao
    BEFORE INSERT ON titulo_baixa
    FOR EACH ROW EXECUTE FUNCTION fn_valida_baixa_transacao();

-- -----------------------------------------------------------------------------
-- 7. RF-066 / RN-005: webhook deduplicado mesmo sem id de evento
--
-- O indice de 02 cobre o provedor que manda `evento_id_externo`. O que nao manda
-- reenvia o mesmo corpo -- e a dedupe passa a ser o hash do payload dentro de
-- uma janela. Fora da janela o mesmo hash pode ser um evento novo e legitimo
-- (duas cobrancas identicas em dias diferentes), por isso a janela e do dia.
-- -----------------------------------------------------------------------------
ALTER TABLE webhook_evento ADD COLUMN IF NOT EXISTS payload_hash varchar(64);
ALTER TABLE webhook_evento ADD COLUMN IF NOT EXISTS proxima_tentativa_em timestamptz;

-- O dia da janela vira coluna gerada em vez de expressao no indice: o cast
-- `timestamptz -> date` depende de TimeZone e por isso e STABLE, e indice
-- exige IMMUTABLE. Fixar UTC resolve os dois problemas de uma vez -- o
-- indice passa a ser construivel e a janela deixa de mudar de tamanho
-- conforme o fuso da sessao que grava.
ALTER TABLE webhook_evento ADD COLUMN IF NOT EXISTS recebido_dia date
    GENERATED ALWAYS AS (((recebido_em AT TIME ZONE 'UTC'))::date) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS ux_webhook_payload_hash_dia
    ON webhook_evento (provider_id, payload_hash, recebido_dia)
    WHERE payload_hash IS NOT NULL AND evento_id_externo IS NULL;

CREATE INDEX IF NOT EXISTS ix_webhook_transacao
    ON webhook_evento (transacao_pagamento_id) WHERE transacao_pagamento_id IS NOT NULL;

COMMENT ON COLUMN webhook_evento.assinatura_valida IS
    'RF-066 - resultado da conferencia HMAC; evento com assinatura invalida e guardado, nunca processado.';

-- Evento com assinatura invalida nao vira efeito: fica registrado como FALHA
-- para investigacao. Guardar e importante -- e o unico rastro de uma tentativa
-- de forjar confirmacao de pagamento.
CREATE OR REPLACE FUNCTION fn_valida_webhook_evento() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.assinatura_valida IS NOT DISTINCT FROM false
       AND NEW.status NOT IN ('PENDENTE','FALHA','CANCELADO') THEN
        RAISE EXCEPTION
            'Webhook % tem assinatura invalida e nao pode ser processado (RF-066).', NEW.id;
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.payload IS DISTINCT FROM OLD.payload THEN
        RAISE EXCEPTION 'O payload do webhook % nao se reescreve (RN-005).', OLD.id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_valida_webhook_evento ON webhook_evento;
CREATE TRIGGER trg_valida_webhook_evento
    BEFORE INSERT OR UPDATE ON webhook_evento
    FOR EACH ROW EXECUTE FUNCTION fn_valida_webhook_evento();

-- -----------------------------------------------------------------------------
-- 8. RF-069 / RF-070 / RN-011: a fila
--
-- `job_execucao` ja existia como registro de execucao. Duas colunas a
-- transformam em fila utilizavel:
--
--   chave_idempotencia  dedupe do enfileiramento -- o mesmo job pedido duas
--                       vezes (retry da API, webhook repetido) e um job so
--                       enquanto ele nao terminou;
--   ultimo_erro_em      quando falhou pela ultima vez, para diagnostico.
--
-- `agendado_para` passa a ter default: quem nao agenda quer agora. O indice
-- parcial de reivindicacao e o que o worker usa com FOR UPDATE SKIP LOCKED --
-- varios workers competindo pela mesma fila nunca pegam o mesmo job (RNF-009).
-- -----------------------------------------------------------------------------
ALTER TABLE job_execucao ADD COLUMN IF NOT EXISTS chave_idempotencia varchar(255);
ALTER TABLE job_execucao ADD COLUMN IF NOT EXISTS ultimo_erro_em timestamptz;
ALTER TABLE job_execucao ALTER COLUMN agendado_para SET DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS ux_job_idempotencia
    ON job_execucao (fila, chave_idempotencia)
    WHERE chave_idempotencia IS NOT NULL AND status IN ('PENDENTE','AGENDADO','PROCESSANDO');

CREATE INDEX IF NOT EXISTS ix_job_reivindicacao
    ON job_execucao (agendado_para, criado_em)
    WHERE status IN ('PENDENTE','AGENDADO');

CREATE OR REPLACE FUNCTION fn_valida_job_execucao() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.tentativas < OLD.tentativas THEN
        RAISE EXCEPTION 'O contador de tentativas do job % nao retrocede (RF-070).', OLD.id;
    END IF;
    IF NEW.tentativas > NEW.max_tentativas THEN
        RAISE EXCEPTION 'O job % excedeu o limite de % tentativas (RF-070).', NEW.id, NEW.max_tentativas;
    END IF;
    IF NEW.status = 'FALHA' AND coalesce(NEW.erro, '') = '' THEN
        RAISE EXCEPTION 'Job % em FALHA exige a mensagem em erro (RF-070).', NEW.id;
    END IF;
    IF NEW.status IN ('CONCLUIDO','FALHA','CANCELADO') THEN
        NEW.finalizado_em := coalesce(NEW.finalizado_em, now());
        IF NEW.iniciado_em IS NOT NULL AND NEW.duracao_ms IS NULL THEN
            NEW.duracao_ms := (extract(epoch FROM (NEW.finalizado_em - NEW.iniciado_em)) * 1000)::integer;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_valida_job_execucao() IS
    'RF-070 - tentativas monotonas, limite respeitado e falha sempre com causa.';

DROP TRIGGER IF EXISTS trg_valida_job_execucao ON job_execucao;
CREATE TRIGGER trg_valida_job_execucao
    BEFORE INSERT OR UPDATE ON job_execucao
    FOR EACH ROW EXECUTE FUNCTION fn_valida_job_execucao();

-- -----------------------------------------------------------------------------
-- 9. RF-060: extrato importado
--
-- O arquivo nao entra duas vezes (uq_extrato_hash, de 02) e a linha do extrato
-- nao entra duas vezes (ux_transacao_bancaria_fitid, tambem de 02). O que falta
-- e coerencia: periodo que nao se inverte, contagens que nao mentem e o saldo da
-- conta acompanhando o ultimo extrato conhecido.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.extrato_importacao'::regclass
                      AND conname = 'ck_extrato_periodo') THEN
        ALTER TABLE gestao.extrato_importacao ADD CONSTRAINT ck_extrato_periodo
            CHECK (periodo_inicio IS NULL OR periodo_fim IS NULL OR periodo_inicio <= periodo_fim);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.extrato_importacao'::regclass
                      AND conname = 'ck_extrato_contagens') THEN
        ALTER TABLE gestao.extrato_importacao ADD CONSTRAINT ck_extrato_contagens
            CHECK (quantidade_registros >= 0
               AND quantidade_importada >= 0
               AND quantidade_duplicada >= 0
               AND quantidade_importada + quantidade_duplicada <= quantidade_registros);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.extrato_importacao'::regclass
                      AND conname = 'ck_extrato_formato') THEN
        ALTER TABLE gestao.extrato_importacao ADD CONSTRAINT ck_extrato_formato
            CHECK (formato IN ('OFX','CSV','CNAB240','API'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_extrato_conta_periodo
    ON extrato_importacao (empresa_id, conta_bancaria_id, periodo_inicio DESC);

-- O saldo da conta segue o extrato mais recente ja importado: um arquivo antigo
-- reprocessado nao pode fazer o saldo andar para tras no tempo.
CREATE OR REPLACE FUNCTION fn_atualiza_saldo_conta_bancaria() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status <> 'CONCLUIDO' OR NEW.saldo_final IS NULL OR NEW.periodo_fim IS NULL THEN
        RETURN NULL;
    END IF;

    UPDATE conta_bancaria
       SET saldo_atual = NEW.saldo_final,
           data_saldo  = NEW.periodo_fim
     WHERE id = NEW.conta_bancaria_id
       AND (data_saldo IS NULL OR data_saldo <= NEW.periodo_fim);

    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION fn_atualiza_saldo_conta_bancaria() IS
    'RF-060 - saldo da conta espelha o extrato mais recente, nunca um mais antigo.';

DROP TRIGGER IF EXISTS trg_atualiza_saldo_conta_bancaria ON extrato_importacao;
CREATE TRIGGER trg_atualiza_saldo_conta_bancaria
    AFTER INSERT OR UPDATE OF status, saldo_final ON extrato_importacao
    FOR EACH ROW EXECUTE FUNCTION fn_atualiza_saldo_conta_bancaria();

-- Movimento bancario e fato consumado do banco: nao se edita nem se apaga.
-- A conciliacao (M10) muda apenas `status_conciliacao` e `metadados`.
CREATE OR REPLACE FUNCTION fn_protege_transacao_bancaria() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Movimento bancario nao e removido (RF-060).';
    END IF;
    IF (NEW.conta_bancaria_id, NEW.data_movimento, NEW.sentido, NEW.valor,
        NEW.identificador_externo, NEW.extrato_importacao_id)
       IS DISTINCT FROM
       (OLD.conta_bancaria_id, OLD.data_movimento, OLD.sentido, OLD.valor,
        OLD.identificador_externo, OLD.extrato_importacao_id) THEN
        RAISE EXCEPTION
            'O movimento bancario % veio do extrato e nao se altera (RF-060).', OLD.id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protege_transacao_bancaria ON transacao_bancaria;
CREATE TRIGGER trg_protege_transacao_bancaria
    BEFORE UPDATE OR DELETE ON transacao_bancaria
    FOR EACH ROW EXECUTE FUNCTION fn_protege_transacao_bancaria();

-- -----------------------------------------------------------------------------
-- 10. RN-001 / RN-002: RLS estrita onde empresa_id e nulavel
--
-- A politica generica de 03 permite `empresa_id IS NULL` a qualquer sessao --
-- e correto para catalogos globais (permissao, perfil de plataforma), mas nao
-- para estas tres: um webhook ainda nao atribuido carrega o payload do provedor,
-- e um job carrega os parametros da operacao.
--
-- Quem precisa atravessar empresas e o worker, e a chave e `app.origem`, que ja
-- existe desde 05 para a trilha de auditoria. O limite de confianca e claro: a
-- API define `app.origem = 'API'` no inicio de toda requisicao HTTP
-- (TenantContextMiddleware) e nunca outra coisa; so o runner de jobs e o
-- receptor de webhooks abrem contexto com WORKER/WEBHOOK, e ambos rodam fora do
-- ciclo de requisicao.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_modo_sistema() RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT coalesce(current_setting('app.origem', true), '') IN ('WORKER','WEBHOOK','SISTEMA');
$$;

COMMENT ON FUNCTION fn_modo_sistema() IS
    'RN-002 - true apenas em contexto de worker/webhook, que nao vem de requisicao HTTP.';

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['idempotencia','webhook_evento','job_execucao'] LOOP
        EXECUTE format('DROP POLICY IF EXISTS pol_%1$s_tenant ON gestao.%1$I;', t);
        EXECUTE format(
            'CREATE POLICY pol_%1$s_tenant ON gestao.%1$I
             USING (gestao.fn_modo_sistema() OR empresa_id = gestao.fn_empresa_corrente())
             WITH CHECK (gestao.fn_modo_sistema() OR empresa_id = gestao.fn_empresa_corrente());', t);
    END LOOP;
END $$;

-- `provider` nao tem empresa_id: e catalogo global, legivel por todos e escrito
-- so pelo owner do schema. Deixar a aplicacao editar provedores permitiria a uma
-- empresa apontar o pagamento de outra para um endpoint proprio.
REVOKE INSERT, UPDATE, DELETE ON provider FROM app_gestao;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sge_api') THEN
        REVOKE INSERT, UPDATE, DELETE ON gestao.provider FROM sge_api;
    END IF;
END $$;

-- =============================================================================
-- CARGA COMPLEMENTAR
-- =============================================================================

-- Capacidades declaradas por provedor (RF-061/RF-065): e delas que sai
-- `transacao_pagamento.cancelavel`.
UPDATE provider
   SET capacidades = '{"pix":true,"boleto":true,"ted":true,"transferencia_interna":true,"cancelamento":false,"webhook":false,"consulta":false}'::jsonb
 WHERE codigo = 'MANUAL' AND capacidades = '{}'::jsonb;

INSERT INTO provider (codigo, nome, categoria, descricao, capacidades) VALUES
 ('SANDBOX','Provedor bancario de homologacao','BANCARIO',
  'Adaptador HTTP generico apontado para o sandbox do banco (RF-061).',
  '{"pix":true,"boleto":true,"ted":true,"cancelamento":true,"webhook":true,"consulta":true}')
ON CONFLICT (codigo) DO NOTHING;

-- =============================================================================
-- FIM - 13_bancos_sprint10.sql
-- =============================================================================
