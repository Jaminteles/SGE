-- =============================================================================
-- 05_auditoria_sprint2.sql
-- Sprint 2 - Fase 1 (Fundacao): M16 - Auditoria (RF-114 a RF-118).
--
-- Executar como gestao_owner, depois de 01 a 04:
--   psql -U gestao_owner -h localhost -d gestao_empresarial -f 05_auditoria_sprint2.sql
-- Idempotente: pode ser reexecutado.
--
-- O que 03 ja entregava: tabela particionada `auditoria`, trigger generico de
-- DML nas entidades criticas e bloqueio de UPDATE/DELETE. Este script fecha as
-- lacunas que faltavam para os requisitos da sprint:
--   1. RF-115 - origem da acao (usuario_nome, ip, user_agent) na trilha
--   2. RF-114 - eventos de negocio que nao nascem de DML (login, aprovacao...)
--   3. RF-117 - indice que sustenta a consulta paginada por periodo
--   4. RF-118 / RN-001 - isolamento por empresa na leitura e retirada dos
--      privilegios de escrita destrutiva da role da aplicacao
-- =============================================================================
SET search_path = gestao, public;

-- -----------------------------------------------------------------------------
-- 1. RF-115: identificacao completa da origem
--
-- O trigger nao enxerga a camada HTTP. A API publica os metadados da requisicao
-- em parametros de sessao (SET LOCAL app.*) e a funcao passa a le-los. Todos sao
-- opcionais: fora de uma requisicao (seed, job, psql) continuam nulos.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_config_texto(p_chave text) RETURNS text
LANGUAGE plpgsql STABLE AS $$
DECLARE v text;
BEGIN
    v := current_setting(p_chave, true);
    IF v IS NULL OR v = '' THEN RETURN NULL; END IF;
    RETURN v;
EXCEPTION WHEN others THEN RETURN NULL;
END;
$$;

COMMENT ON FUNCTION fn_config_texto(text) IS
    'Le um parametro de sessao app.* tratando ausente e vazio como NULL.';

CREATE OR REPLACE FUNCTION fn_auditoria_generica() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_anterior  jsonb;
    v_posterior jsonb;
    v_evento    enum_tipo_evento_auditoria;
    v_campos    text[];
    v_empresa   uuid;
    v_ip        inet;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_evento := 'CRIACAO';
        v_posterior := to_jsonb(NEW);
    ELSIF TG_OP = 'UPDATE' THEN
        v_evento := 'ALTERACAO';
        v_anterior := to_jsonb(OLD);
        v_posterior := to_jsonb(NEW);
        SELECT array_agg(chave)
          INTO v_campos
          FROM jsonb_each(v_posterior) AS n(chave, valor)
         WHERE v_anterior -> n.chave IS DISTINCT FROM n.valor;
    ELSE
        v_evento := 'EXCLUSAO';
        v_anterior := to_jsonb(OLD);
    END IF;

    -- RNF-001: hash de senha nunca entra na trilha, nem como valor anterior.
    v_anterior  := v_anterior  - 'senha_hash' - 'refresh_token_hash' - 'token_hash';
    v_posterior := v_posterior - 'senha_hash' - 'refresh_token_hash' - 'token_hash';

    v_empresa := coalesce((v_posterior ->> 'empresa_id')::uuid,
                          (v_anterior  ->> 'empresa_id')::uuid,
                          fn_empresa_corrente());

    -- inet invalido nao pode derrubar a operacao auditada: cai para NULL.
    BEGIN
        v_ip := fn_config_texto('app.ip')::inet;
    EXCEPTION WHEN others THEN v_ip := NULL;
    END;

    INSERT INTO auditoria (empresa_id, usuario_id, usuario_nome, evento, entidade,
                           entidade_id, valor_anterior, valor_posterior,
                           campos_alterados, origem, ip, user_agent, correlation_id)
    VALUES (v_empresa,
            fn_usuario_corrente(),
            fn_config_texto('app.usuario_nome'),
            v_evento,
            TG_TABLE_NAME,
            coalesce((v_posterior ->> 'id')::uuid, (v_anterior ->> 'id')::uuid),
            v_anterior,
            v_posterior,
            coalesce(v_campos, '{}'),
            coalesce(fn_config_texto('app.origem'), 'API'),
            v_ip,
            fn_config_texto('app.user_agent'),
            fn_config_texto('app.correlation_id'));

    RETURN coalesce(NEW, OLD);
END;
$$;

-- Reaplica o search_path fixo exigido por 04 (a funcao acabou de ser recriada).
ALTER FUNCTION fn_auditoria_generica() SET search_path = gestao, public;
ALTER FUNCTION fn_config_texto(text)   SET search_path = gestao, public;

-- -----------------------------------------------------------------------------
-- 2. RF-114: eventos de negocio
--
-- CRIACAO/ALTERACAO/EXCLUSAO saem do trigger de DML. Aprovacao, pagamento,
-- recebimento, cancelamento, login e acesso negado sao decisoes da aplicacao:
-- nao ha DML que as represente sozinha. A API grava esses eventos por esta
-- funcao, que centraliza o preenchimento dos metadados de origem.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_registra_evento_auditoria(
    p_evento      enum_tipo_evento_auditoria,
    p_entidade    varchar(60),
    p_entidade_id uuid    DEFAULT NULL,
    p_empresa_id  uuid    DEFAULT NULL,
    p_usuario_id  uuid    DEFAULT NULL,
    p_observacao  text    DEFAULT NULL,
    p_anterior    jsonb   DEFAULT NULL,
    p_posterior   jsonb   DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
    v_id bigint;
    v_ip inet;
BEGIN
    BEGIN
        v_ip := fn_config_texto('app.ip')::inet;
    EXCEPTION WHEN others THEN v_ip := NULL;
    END;

    INSERT INTO auditoria (empresa_id, usuario_id, usuario_nome, evento, entidade,
                           entidade_id, valor_anterior, valor_posterior, origem,
                           ip, user_agent, correlation_id, observacao)
    VALUES (coalesce(p_empresa_id, fn_empresa_corrente()),
            coalesce(p_usuario_id, fn_usuario_corrente()),
            fn_config_texto('app.usuario_nome'),
            p_evento,
            p_entidade,
            p_entidade_id,
            p_anterior,
            p_posterior,
            coalesce(fn_config_texto('app.origem'), 'API'),
            v_ip,
            fn_config_texto('app.user_agent'),
            fn_config_texto('app.correlation_id'),
            p_observacao)
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

ALTER FUNCTION fn_registra_evento_auditoria(
    enum_tipo_evento_auditoria, varchar, uuid, uuid, uuid, text, jsonb, jsonb)
    SET search_path = gestao, public;

COMMENT ON FUNCTION fn_registra_evento_auditoria(
    enum_tipo_evento_auditoria, varchar, uuid, uuid, uuid, text, jsonb, jsonb) IS
    'RF-114 - registra evento de negocio na trilha (o que nao vem de DML).';

-- -----------------------------------------------------------------------------
-- 3. RF-117: indice de apoio a consulta paginada
--
-- Os indices de 03 cobrem a busca por entidade e por usuario. A listagem padrao
-- da API e "a empresa X, do mais recente para o mais antigo", com filtro
-- opcional de evento.
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS ix_auditoria_empresa_periodo
    ON auditoria (empresa_id, ocorrido_em DESC);
CREATE INDEX IF NOT EXISTS ix_auditoria_evento
    ON auditoria (empresa_id, evento, ocorrido_em DESC);

-- `campos_alterados` so era preenchido em UPDATE; nas demais operacoes ficava
-- NULL. O cliente Prisma tipa a coluna como lista nao-anulavel (listas escalares
-- nao admitem NULL no Prisma), entao a leitura de uma linha de CRIACAO cairia
-- num valor que o tipo declara impossivel. Lista vazia diz o mesmo sem ambiguidade.
ALTER TABLE auditoria ALTER COLUMN campos_alterados SET DEFAULT '{}';

-- -----------------------------------------------------------------------------
-- 4. RN-001: isolamento multiempresa na leitura da trilha
--
-- 03 deixou `auditoria` de fora do laco que habilitou RLS (a condicao era ter
-- coluna empresa_id, com `auditoria` explicitamente excluida). Sem politica, um
-- defeito no filtro da API exporia a trilha de outras empresas.
--
-- A politica de SELECT e estrita: `empresa_id IS NULL` (eventos de plataforma,
-- como login antes de escolher a empresa) NAO aparece na trilha de nenhum
-- tenant. A de INSERT e permissiva - a trilha nunca pode recusar um registro,
-- ou a RLS viraria um jeito de operar sem deixar rastro.
-- -----------------------------------------------------------------------------
ALTER TABLE auditoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE auditoria FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pol_auditoria_tenant_leitura ON auditoria;
CREATE POLICY pol_auditoria_tenant_leitura ON auditoria
    FOR SELECT USING (empresa_id = fn_empresa_corrente());

DROP POLICY IF EXISTS pol_auditoria_insercao ON auditoria;
CREATE POLICY pol_auditoria_insercao ON auditoria
    FOR INSERT WITH CHECK (true);

-- ATENCAO: a politica acima so e aplicada quando a consulta passa pela tabela
-- particionada. Lendo uma particao diretamente (SELECT ... FROM auditoria_2026m08)
-- valem apenas as politicas da propria particao - nenhuma. Como 04 concedeu
-- privilegios "ON ALL TABLES", as particoes ficaram acessiveis a role da API e
-- o isolamento poderia ser contornado sem esforco.
--
-- A correcao e retirar o acesso direto: consultas pelo pai nao verificam
-- privilegio nas particoes, entao a API continua funcionando normalmente.
DO $$
DECLARE
    v_particao text;
    v_role     text;
BEGIN
    FOR v_particao IN
        SELECT c.relid::regclass::text
          FROM pg_partition_tree('gestao.auditoria'::regclass) c
         WHERE c.relid <> 'gestao.auditoria'::regclass
    LOOP
        FOREACH v_role IN ARRAY ARRAY['app_gestao', 'sge_api'] LOOP
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
                EXECUTE format('REVOKE ALL ON %s FROM %I;', v_particao, v_role);
            END IF;
        END LOOP;
    END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 5. RF-118: append-only tambem por privilegio
--
-- O trigger trg_auditoria_imutavel (03) ja rejeita UPDATE/DELETE. Retirar o
-- privilegio e a segunda barreira: um trigger pode ser desabilitado por quem
-- tem direito sobre a tabela, um GRANT ausente nao.
-- -----------------------------------------------------------------------------
DO $$
DECLARE r text;
BEGIN
    FOREACH r IN ARRAY ARRAY['app_gestao', 'sge_api'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON gestao.auditoria FROM %I;', r);
            EXECUTE format('GRANT SELECT, INSERT ON gestao.auditoria TO %I;', r);
            EXECUTE format(
                'GRANT EXECUTE ON FUNCTION gestao.fn_registra_evento_auditoria(
                     gestao.enum_tipo_evento_auditoria, varchar, uuid, uuid, uuid,
                     text, jsonb, jsonb) TO %I;', r);
        END IF;
    END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 6. Verificacao
-- -----------------------------------------------------------------------------
DO $$
DECLARE v_falhas int := 0;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname='gestao' AND tablename='auditoria'
                      AND policyname='pol_auditoria_tenant_leitura') THEN
        RAISE WARNING 'RLS de leitura da auditoria ausente'; v_falhas := v_falhas + 1;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_trigger
                    WHERE tgrelid = 'gestao.auditoria'::regclass
                      AND tgname = 'trg_auditoria_imutavel') THEN
        RAISE WARNING 'trigger de imutabilidade ausente (RF-118)'; v_falhas := v_falhas + 1;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_proc
                WHERE pronamespace='gestao'::regnamespace AND proconfig IS NULL) THEN
        RAISE WARNING 'ha funcoes sem search_path'; v_falhas := v_falhas + 1;
    END IF;

    IF v_falhas = 0 THEN
        RAISE NOTICE 'M16 - Auditoria: ajustes aplicados com sucesso.';
    END IF;
END $$;
