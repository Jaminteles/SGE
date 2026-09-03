-- =============================================================================
-- 20_integracoes_sprint17.sql
-- Sprint 17 - Fase 8 (Gestao Avancada): M18 - Administracao e Integracoes
-- (RF-126 a RF-131).
--
-- Executar como gestao_owner, depois de 01 a 19:
--   psql -U gestao_owner -h localhost -d gestao_empresarial -f 20_integracoes_sprint17.sql
-- Idempotente: pode ser reexecutado.
--
-- O que bd/13 ja entregava do M09: o catalogo global `provider` (somente
-- leitura pela API) e o segredo por empresa em `credencial_integracao`, cifrado
-- e nunca devolvido. O que faltava e a camada de operacao -- e ela e o M18:
--
--   1. RF-126 - `integracao`: qual integracao desta empresa esta ligada, com
--      qual provedor, qual credencial e em que ambiente;
--   2. RF-127 - `integracao.parametros`: o que e especifico do provedor e nao e
--      segredo, com trigger que recusa chave com cara de credencial;
--   3. RF-128 - contadores de saude na propria linha (ultimo sucesso, ultimo
--      erro, falhas consecutivas) e suspensao automatica no limite;
--   4. RF-129 - `integracao_evento`: diario append-only do que a integracao fez;
--   5. RF-130 - reprocessamento: o evento de reprocessamento e registrado, e a
--      idempotencia de quem reexecuta e a de `job_execucao` (ux_job_idempotencia
--      de bd/13), nao uma segunda inventada aqui;
--   6. RN-001/RN-002 - RLS nas duas tabelas novas.
--
-- Tres decisoes estruturais:
--
--   a) **o evento nao se reescreve**. `integracao_evento` recusa UPDATE e
--      DELETE por trigger. Um log de erro editavel depois do incidente nao serve
--      para investigar o incidente -- e e exatamente durante a investigacao que
--      alguem tem motivo para edita-lo;
--   b) **parametro nao guarda segredo**. `parametros` e jsonb legivel por quem
--      administra a empresa; segredo mora cifrado em `credencial_integracao`.
--      Sem a trava da secao 3, o caminho mais facil de vazar uma senha do
--      sistema passa a ser cadastra-la como "parametro";
--   c) **a credencial da integracao e da mesma empresa e do mesmo provedor**. A
--      FK so olha o id: uma credencial de outra empresa nao viola FK nenhuma, e
--      a RLS tampouco a impede -- a linha gravada e da empresa corrente, o alvo
--      e que e de fora.
-- =============================================================================

SET search_path TO gestao, public;

-- -----------------------------------------------------------------------------
-- 1. Tipos
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                    WHERE t.typname = 'enum_status_integracao' AND n.nspname = 'gestao') THEN
        CREATE TYPE gestao.enum_status_integracao AS ENUM ('ATIVA','INATIVA','SUSPENSA','ERRO');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                    WHERE t.typname = 'enum_severidade_integracao' AND n.nspname = 'gestao') THEN
        CREATE TYPE gestao.enum_severidade_integracao AS ENUM ('INFO','AVISO','ERRO','CRITICO');
    END IF;
END $$;

COMMENT ON TYPE gestao.enum_status_integracao IS
    'RF-126/RF-128 - INATIVA e decisao do administrador; SUSPENSA e o sistema recusando-se a continuar chamando um provedor que so devolve erro.';

-- -----------------------------------------------------------------------------
-- 2. RF-126: integracao configurada pela empresa
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS integracao (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id          uuid NOT NULL REFERENCES empresa (id) ON DELETE CASCADE,
    provider_id         uuid NOT NULL REFERENCES provider (id),
    credencial_id       uuid REFERENCES credencial_integracao (id),
    codigo              varchar(60) NOT NULL,
    nome                varchar(120) NOT NULL,
    ambiente            varchar(20) NOT NULL DEFAULT 'PRODUCAO',
    parametros          jsonb NOT NULL DEFAULT '{}'::jsonb,
    status              gestao.enum_status_integracao NOT NULL DEFAULT 'INATIVA',
    ativo               boolean NOT NULL DEFAULT true,
    timeout_ms          integer NOT NULL DEFAULT 10000,
    max_tentativas      smallint NOT NULL DEFAULT 5,
    falhas_consecutivas smallint NOT NULL DEFAULT 0,
    limite_falhas       smallint NOT NULL DEFAULT 10,
    ultima_execucao_em  timestamptz,
    ultimo_sucesso_em   timestamptz,
    ultimo_erro_em      timestamptz,
    ultimo_erro         text,
    motivo_suspensao    text,
    observacao          text,
    criado_em           timestamptz NOT NULL DEFAULT now(),
    atualizado_em       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_integracao_ambiente CHECK (ambiente IN ('PRODUCAO','HOMOLOGACAO','SANDBOX')),
    CONSTRAINT ck_integracao_timeout CHECK (timeout_ms BETWEEN 500 AND 120000),
    CONSTRAINT ck_integracao_tentativas CHECK (max_tentativas BETWEEN 1 AND 20),
    CONSTRAINT ck_integracao_limite CHECK (limite_falhas BETWEEN 1 AND 100),
    CONSTRAINT ck_integracao_falhas CHECK (falhas_consecutivas >= 0),
    -- Parametro e objeto JSON, nao lista nem escalar: a leitura por chave e o
    -- unico uso, e um array aqui quebraria todo consumidor sem aviso.
    CONSTRAINT ck_integracao_parametros CHECK (jsonb_typeof(parametros) = 'object')
);


-- Reconciliacao com a versao de bd/03.
--
-- `integracao` nasce em 03_schema_contabil_governanca.sql com o desenho
-- anterior do M18 (configuracao/url_base/contadores agregados). O
-- CREATE TABLE IF NOT EXISTS acima nao faz nada quando a tabela ja existe --
-- e era por isso que uma instalacao limpa parava aqui, no primeiro uso de
-- `parametros`. As colunas do desenho definitivo entram por ALTER, de forma
-- idempotente, e as colunas antigas ficam onde estao: derruba-las apagaria
-- dado de quem ja instalou, e todas tem default ou aceitam nulo, entao nao
-- atrapalham a escrita pela API.
ALTER TABLE integracao
    ADD COLUMN IF NOT EXISTS codigo              varchar(60),
    ADD COLUMN IF NOT EXISTS ambiente            varchar(20) NOT NULL DEFAULT 'PRODUCAO',
    ADD COLUMN IF NOT EXISTS parametros          jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS ativo               boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS timeout_ms          integer NOT NULL DEFAULT 10000,
    ADD COLUMN IF NOT EXISTS max_tentativas      smallint NOT NULL DEFAULT 5,
    ADD COLUMN IF NOT EXISTS falhas_consecutivas smallint NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS limite_falhas       smallint NOT NULL DEFAULT 10,
    ADD COLUMN IF NOT EXISTS ultima_execucao_em  timestamptz,
    ADD COLUMN IF NOT EXISTS ultimo_sucesso_em   timestamptz,
    ADD COLUMN IF NOT EXISTS motivo_suspensao    text,
    ADD COLUMN IF NOT EXISTS observacao          text;

-- `codigo` e NOT NULL no desenho definitivo. Linha herdada nao tem codigo:
-- deriva-se do nome, com um sufixo do id para nao colidir no unico por empresa.
UPDATE integracao
   SET codigo = left(regexp_replace(upper(nome), '[^A-Z0-9]+', '_', 'g'), 50)
                || '_' || left(id::text, 8)
 WHERE codigo IS NULL;

ALTER TABLE integracao ALTER COLUMN codigo SET NOT NULL;

-- INATIVA e o default do desenho definitivo: uma integracao recem-criada nao
-- comeca chamando provedor externo sem alguem ligar (RF-126).
ALTER TABLE integracao ALTER COLUMN status SET DEFAULT 'INATIVA';

-- A identidade da integracao passou a ser (empresa_id, codigo). A unica antiga
-- por (empresa_id, provider_id, nome) recusaria dois cadastros legitimos do
-- mesmo provedor com o mesmo nome em ambientes diferentes.
ALTER TABLE integracao DROP CONSTRAINT IF EXISTS uq_integracao;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'ck_integracao_ambiente'
                      AND conrelid = 'gestao.integracao'::regclass) THEN
        ALTER TABLE integracao ADD CONSTRAINT ck_integracao_ambiente
            CHECK (ambiente IN ('PRODUCAO','HOMOLOGACAO','SANDBOX'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'ck_integracao_timeout'
                      AND conrelid = 'gestao.integracao'::regclass) THEN
        ALTER TABLE integracao ADD CONSTRAINT ck_integracao_timeout
            CHECK (timeout_ms BETWEEN 500 AND 120000);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'ck_integracao_tentativas'
                      AND conrelid = 'gestao.integracao'::regclass) THEN
        ALTER TABLE integracao ADD CONSTRAINT ck_integracao_tentativas
            CHECK (max_tentativas BETWEEN 1 AND 20);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'ck_integracao_limite'
                      AND conrelid = 'gestao.integracao'::regclass) THEN
        ALTER TABLE integracao ADD CONSTRAINT ck_integracao_limite
            CHECK (limite_falhas BETWEEN 1 AND 100);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'ck_integracao_falhas'
                      AND conrelid = 'gestao.integracao'::regclass) THEN
        ALTER TABLE integracao ADD CONSTRAINT ck_integracao_falhas
            CHECK (falhas_consecutivas >= 0);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'ck_integracao_parametros'
                      AND conrelid = 'gestao.integracao'::regclass) THEN
        ALTER TABLE integracao ADD CONSTRAINT ck_integracao_parametros
            CHECK (jsonb_typeof(parametros) = 'object');
    END IF;
END $$;

COMMENT ON TABLE integracao IS
    'RF-126 - integracao externa configurada pela empresa: provedor, credencial, ambiente e parametros.';
COMMENT ON COLUMN integracao.parametros IS
    'RF-127 - parametros nao sensiveis do provedor. Segredo mora cifrado em credencial_integracao (RNF-003).';
COMMENT ON COLUMN integracao.falhas_consecutivas IS
    'RF-128 - falhas seguidas desde o ultimo sucesso; ao atingir limite_falhas a integracao e suspensa.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_integracao_codigo
    ON integracao (empresa_id, codigo);
CREATE INDEX IF NOT EXISTS ix_integracao_status
    ON integracao (empresa_id, status);
CREATE INDEX IF NOT EXISTS ix_integracao_credencial
    ON integracao (credencial_id) WHERE credencial_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 3. RF-127: parametro nao guarda segredo
--
-- `parametros` e legivel por quem tem integrations:READ. Aceitar uma chave
-- chamada `password`, `token` ou `secret` ali seria oferecer um lugar mais
-- comodo -- e sem cifra -- do que `credencial_integracao`. A trava e no banco e
-- nao so no DTO porque o banco e o unico ponto por onde todo caminho passa.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_valida_parametros_integracao() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE k text;
BEGIN
    FOR k IN SELECT jsonb_object_keys(NEW.parametros) LOOP
        IF lower(k) ~ '(senha|password|secret|segredo|token|api[_-]?key|chave[_-]?api|private[_-]?key|credential|credencial|authorization|passphrase)' THEN
            RAISE EXCEPTION
                'O parametro "%" tem nome de credencial. Segredo se cadastra em credencial_integracao, cifrado (RF-127/RNF-003).', k;
        END IF;
    END LOOP;

    IF NEW.credencial_id IS NOT NULL THEN
        PERFORM 1 FROM credencial_integracao c
         WHERE c.id = NEW.credencial_id
           AND c.empresa_id = NEW.empresa_id
           AND c.provider_id = NEW.provider_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION
                'A credencial da integracao e de outra empresa ou de outro provedor (RN-001).';
        END IF;
    END IF;

    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_integracao_parametros ON integracao;
CREATE TRIGGER trg_integracao_parametros
    BEFORE INSERT OR UPDATE ON integracao
    FOR EACH ROW EXECUTE FUNCTION fn_valida_parametros_integracao();

DROP TRIGGER IF EXISTS trg_integracao_atualizado_em ON integracao;
CREATE TRIGGER trg_integracao_atualizado_em
    BEFORE UPDATE ON integracao
    FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();

-- -----------------------------------------------------------------------------
-- 4. RF-129: diario da integracao
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS integracao_evento (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id      uuid NOT NULL REFERENCES empresa (id) ON DELETE CASCADE,
    integracao_id   uuid REFERENCES integracao (id) ON DELETE SET NULL,
    provider_id     uuid REFERENCES provider (id),
    tipo            varchar(60) NOT NULL,
    severidade      gestao.enum_severidade_integracao NOT NULL DEFAULT 'INFO',
    operacao        varchar(120),
    mensagem        text NOT NULL,
    detalhe         jsonb,
    referencia_tipo varchar(60),
    referencia_id   uuid,
    status_http     integer,
    duracao_ms      integer,
    tentativa       smallint,
    correlation_id  varchar(60),
    ocorrido_em     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_integracao_evento_tipo CHECK (tipo IN (
        'CHAMADA','RESPOSTA','ERRO','WEBHOOK','REPROCESSAMENTO','CONFIGURACAO','TESTE','SUSPENSAO'
    )),
    CONSTRAINT ck_integracao_evento_http CHECK (status_http IS NULL OR status_http BETWEEN 100 AND 599),
    CONSTRAINT ck_integracao_evento_duracao CHECK (duracao_ms IS NULL OR duracao_ms >= 0)
);

COMMENT ON TABLE integracao_evento IS
    'RF-129 - diario append-only das integracoes: chamada, resposta, erro, webhook, reprocessamento e mudanca de configuracao.';
COMMENT ON COLUMN integracao_evento.detalhe IS
    'Payload ja redigido pela aplicacao - nunca credencial, token ou corpo bruto de autenticacao.';

CREATE INDEX IF NOT EXISTS ix_integracao_evento_data
    ON integracao_evento (empresa_id, ocorrido_em DESC);
CREATE INDEX IF NOT EXISTS ix_integracao_evento_severidade
    ON integracao_evento (integracao_id, severidade);
-- O painel de saude (RF-128) le so o que deu errado, e essa e a leitura que
-- precisa continuar barata quando a tabela tiver milhoes de linhas de INFO.
CREATE INDEX IF NOT EXISTS ix_integracao_evento_falha
    ON integracao_evento (empresa_id, ocorrido_em DESC)
    WHERE severidade IN ('ERRO','CRITICO');
CREATE INDEX IF NOT EXISTS ix_integracao_evento_referencia
    ON integracao_evento (referencia_tipo, referencia_id)
    WHERE referencia_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 5. RF-129: o evento nao se reescreve
--
-- Append-only por trigger, e nao so por privilegio: o owner do schema tambem
-- passa por aqui. Corrigir um evento e apagar a prova do que aconteceu; quando a
-- informacao muda, o certo e um evento novo apontando para o mesmo
-- `referencia_id`.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_bloqueia_alteracao_evento_integracao() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION
        'integracao_evento e append-only: registre um evento novo em vez de alterar o anterior (RF-129).';
END $$;

DROP TRIGGER IF EXISTS trg_integracao_evento_imutavel ON integracao_evento;
CREATE TRIGGER trg_integracao_evento_imutavel
    BEFORE UPDATE OR DELETE ON integracao_evento
    FOR EACH ROW EXECUTE FUNCTION fn_bloqueia_alteracao_evento_integracao();

-- -----------------------------------------------------------------------------
-- 6. RF-128: suspensao automatica
--
-- Contar falhas na aplicacao e deixar a contagem depender de qual processo
-- registrou o evento. Aqui ela e consequencia direta do que foi gravado: o
-- evento de erro incrementa, o de sucesso zera, e ao cruzar `limite_falhas` a
-- integracao vai para SUSPENSA -- que so sai por acao humana (RF-126).
--
-- SECURITY DEFINER: o trigger precisa atualizar a linha de `integracao` da
-- mesma empresa do evento, e o evento pode ser gravado em contexto de worker,
-- onde `app.empresa_id` nao e a empresa dele. `search_path` fixo porque
-- SECURITY DEFINER sem isso e escalonamento de privilegio.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_atualiza_saude_integracao() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = gestao, pg_temp AS $$
DECLARE v_falhas smallint; v_limite smallint;
BEGIN
    IF NEW.integracao_id IS NULL THEN
        RETURN NEW;
    END IF;

    IF NEW.severidade IN ('ERRO','CRITICO') THEN
        UPDATE integracao
           SET falhas_consecutivas = least(falhas_consecutivas + 1, 32000),
               ultima_execucao_em  = NEW.ocorrido_em,
               ultimo_erro_em      = NEW.ocorrido_em,
               ultimo_erro         = left(NEW.mensagem, 2000)
         WHERE id = NEW.integracao_id
           AND empresa_id = NEW.empresa_id
        RETURNING falhas_consecutivas, limite_falhas INTO v_falhas, v_limite;

        IF v_falhas IS NOT NULL AND v_falhas >= v_limite THEN
            UPDATE integracao
               SET status = 'SUSPENSA',
                   motivo_suspensao = format(
                       '%s falhas consecutivas ate %s: %s',
                       v_falhas, NEW.ocorrido_em, left(NEW.mensagem, 500))
             WHERE id = NEW.integracao_id
               AND status <> 'SUSPENSA';
        END IF;

    ELSIF NEW.tipo IN ('RESPOSTA','TESTE') THEN
        UPDATE integracao
           SET falhas_consecutivas = 0,
               ultima_execucao_em  = NEW.ocorrido_em,
               ultimo_sucesso_em   = NEW.ocorrido_em,
               status = CASE WHEN status = 'ERRO' THEN 'ATIVA' ELSE status END
         WHERE id = NEW.integracao_id
           AND empresa_id = NEW.empresa_id;
    END IF;

    RETURN NEW;
END $$;

COMMENT ON FUNCTION fn_atualiza_saude_integracao() IS
    'RF-128 - mantem os contadores de saude da integracao a partir dos eventos gravados. Sucesso nao tira de SUSPENSA: sair de suspensao e decisao humana.';

DROP TRIGGER IF EXISTS trg_integracao_evento_saude ON integracao_evento;
CREATE TRIGGER trg_integracao_evento_saude
    AFTER INSERT ON integracao_evento
    FOR EACH ROW EXECUTE FUNCTION fn_atualiza_saude_integracao();

-- -----------------------------------------------------------------------------
-- 7. RF-128: leitura agregada da saude
--
-- security_invoker: sem ele a view roda com a RLS do dono do schema e o painel
-- de uma empresa mostraria as integracoes de todas.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_integracao_saude WITH (security_invoker = true) AS
SELECT i.id                AS integracao_id,
       i.empresa_id,
       i.codigo,
       i.nome,
       i.status,
       i.ativo,
       p.codigo            AS provedor_codigo,
       p.categoria         AS provedor_categoria,
       i.falhas_consecutivas,
       i.limite_falhas,
       i.ultima_execucao_em,
       i.ultimo_sucesso_em,
       i.ultimo_erro_em,
       i.ultimo_erro,
       count(e.id) FILTER (
           WHERE e.ocorrido_em >= now() - interval '24 hours')                    AS eventos_24h,
       count(e.id) FILTER (
           WHERE e.ocorrido_em >= now() - interval '24 hours'
             AND e.severidade IN ('ERRO','CRITICO'))                              AS erros_24h,
       max(e.ocorrido_em) FILTER (WHERE e.severidade IN ('ERRO','CRITICO'))       AS ultimo_evento_erro_em
  FROM integracao i
  JOIN provider p ON p.id = i.provider_id
  LEFT JOIN integracao_evento e ON e.integracao_id = i.id
 GROUP BY i.id, p.codigo, p.categoria;

COMMENT ON VIEW vw_integracao_saude IS
    'RF-128 - situacao corrente de cada integracao com a contagem de eventos e erros das ultimas 24h.';

-- -----------------------------------------------------------------------------
-- 8. RN-010: integracao auditada
--
-- `integracao` entra no trigger generico de DML: ligar, desligar ou repontar
-- uma integracao muda por onde o dinheiro e o documento fiscal da empresa
-- passam. `integracao_evento` fica de fora -- ela ja e a propria trilha, e
-- duplica-la em `auditoria` dobraria o volume sem acrescentar informacao.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
                    WHERE tgrelid = 'gestao.integracao'::regclass
                      AND tgname = 'trg_integracao_auditoria') THEN
        CREATE TRIGGER trg_integracao_auditoria
            AFTER INSERT OR UPDATE OR DELETE ON gestao.integracao
            FOR EACH ROW EXECUTE FUNCTION gestao.fn_auditoria_generica();
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 9. RN-001 / RN-002: RLS
--
-- `empresa_id` e NOT NULL nas duas, entao a politica generica de 03 ja seria
-- correta; recria-la aqui garante que a tabela nova nasca com politica -- e sem
-- politica, com FORCE RLS, a tabela nao responde, o que aparece como "bug de
-- consulta" em vez de falha de isolamento.
--
-- `fn_modo_sistema()` entra porque o worker e o receptor de webhook gravam
-- evento fora do ciclo de requisicao HTTP, onde `app.empresa_id` nao esta
-- definido (bd/13 secao 10). O limite de confianca e o mesmo: so worker e
-- webhook abrem contexto com essa origem.
-- -----------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['integracao','integracao_evento'] LOOP
        EXECUTE format('ALTER TABLE gestao.%I ENABLE ROW LEVEL SECURITY;', t);
        EXECUTE format('ALTER TABLE gestao.%I FORCE ROW LEVEL SECURITY;', t);
        EXECUTE format('DROP POLICY IF EXISTS pol_%1$s_tenant ON gestao.%1$I;', t);
        EXECUTE format(
            'CREATE POLICY pol_%1$s_tenant ON gestao.%1$I
             USING (gestao.fn_modo_sistema() OR empresa_id = gestao.fn_empresa_corrente())
             WITH CHECK (gestao.fn_modo_sistema() OR empresa_id = gestao.fn_empresa_corrente());', t);
    END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 10. Privilegios
--
-- `integracao_evento` nao recebe UPDATE nem DELETE: o trigger da secao 5 ja os
-- recusa, e revogar o privilegio faz a tentativa parar antes -- defesa em
-- profundidade, nao redundancia inutil.
-- -----------------------------------------------------------------------------
DO $$
DECLARE r text;
BEGIN
    FOREACH r IN ARRAY ARRAY['app_gestao', 'sge_api'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON gestao.integracao TO %I;', r);
            EXECUTE format('GRANT SELECT, INSERT ON gestao.integracao_evento TO %I;', r);
            EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON gestao.integracao_evento FROM %I;', r);
            EXECUTE format('GRANT SELECT ON gestao.vw_integracao_saude TO %I;', r);
        END IF;
    END LOOP;
END $$;

-- =============================================================================
-- FIM - 20_integracoes_sprint17.sql
-- =============================================================================
