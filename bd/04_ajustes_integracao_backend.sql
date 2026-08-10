-- =============================================================================
-- 04_ajustes_integracao_backend.sql
-- Correcoes do modelo fisico + ajustes necessarios para a API (backend NestJS).
-- Executar como gestao_owner, depois de 01, 02 e 03:
--   psql -U gestao_owner -h localhost -d gestao_empresarial -f 04_ajustes_integracao_backend.sql
-- Idempotente: pode ser reexecutado.
-- =============================================================================
SET search_path = gestao, public;

-- -----------------------------------------------------------------------------
-- 1. CORRECAO: alcada_aprovador era impossivel de popular
--
-- A PK (alcada_id, usuario_id, perfil_id) impoe NOT NULL nas tres colunas,
-- enquanto ck_alcada_aprovador exige que exatamente UMA entre usuario_id e
-- perfil_id seja NULL. Nenhuma linha podia satisfazer as duas regras.
-- Solucao: PK surrogate + indices unicos parciais por tipo de aprovador.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint
                WHERE conrelid = 'gestao.alcada_aprovador'::regclass AND contype = 'p'
                  AND array_length(conkey, 1) = 3) THEN
        ALTER TABLE alcada_aprovador DROP CONSTRAINT alcada_aprovador_pkey;
        ALTER TABLE alcada_aprovador ALTER COLUMN usuario_id DROP NOT NULL;
        ALTER TABLE alcada_aprovador ALTER COLUMN perfil_id  DROP NOT NULL;
    END IF;
END $$;

ALTER TABLE alcada_aprovador
    ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.alcada_aprovador'::regclass AND contype = 'p') THEN
        ALTER TABLE alcada_aprovador ADD PRIMARY KEY (id);
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_alcada_aprovador_perfil
    ON alcada_aprovador (alcada_id, perfil_id)  WHERE perfil_id  IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_alcada_aprovador_usuario
    ON alcada_aprovador (alcada_id, usuario_id) WHERE usuario_id IS NOT NULL;

COMMENT ON TABLE alcada_aprovador IS
    'RF-012 - Aprovadores da alcada: exatamente um entre usuario_id e perfil_id.';

-- -----------------------------------------------------------------------------
-- 2. CORRECAO: funcoes sem search_path fixo
--
-- fn_auditoria_generica e as demais referenciam tipos/tabelas sem qualificar o
-- schema. Se o cliente conectar sem "gestao" no search_path, qualquer INSERT em
-- tabela auditada falha com 'tipo enum_tipo_evento_auditoria nao existe'.
-- -----------------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
    FOR r IN SELECT p.oid::regprocedure AS f
               FROM pg_proc p
              WHERE p.pronamespace = 'gestao'::regnamespace
                AND p.proconfig IS DISTINCT FROM ARRAY['search_path=gestao, public']
    LOOP
        EXECUTE format('ALTER FUNCTION %s SET search_path = gestao, public;', r.f);
    END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 3. Administrador de plataforma (super admin)
--
-- A ERS preve um administrador que gerencia empresas e usuarios acima do RBAC
-- por empresa; nao havia coluna correspondente em usuario.
-- -----------------------------------------------------------------------------
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS super_admin boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN usuario.super_admin IS
    'Administrador de plataforma: ignora o RBAC por empresa (RF-007).';

-- -----------------------------------------------------------------------------
-- 4. RLS: leitura das proprias associacoes
--
-- A politica de tenant exige app.empresa_id definido. No login, porem, a API
-- ainda nao sabe qual empresa sera usada: precisa listar as empresas do proprio
-- usuario. Politicas permissivas adicionais (OR) liberam somente as linhas do
-- usuario corrente -- o isolamento entre empresas continua valendo.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS pol_usuario_empresa_proprio ON usuario_empresa;
CREATE POLICY pol_usuario_empresa_proprio ON usuario_empresa
    FOR SELECT USING (usuario_id = fn_usuario_corrente());

DROP POLICY IF EXISTS pol_perfil_proprio ON perfil;
CREATE POLICY pol_perfil_proprio ON perfil
    FOR SELECT USING (EXISTS (
        SELECT 1 FROM usuario_empresa ue
         WHERE ue.perfil_id = perfil.id
           AND ue.usuario_id = fn_usuario_corrente()
    ));

-- -----------------------------------------------------------------------------
-- 5. Role de conexao da aplicacao
--
-- app_gestao foi criada NOLOGIN em 03. A API precisa de um login proprio que
-- herde essas permissoes e permaneca sujeito a RLS (ao contrario do owner, que
-- e dono das tabelas). Troque a senha antes de usar fora de desenvolvimento.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sge_api') THEN
        CREATE ROLE sge_api WITH LOGIN PASSWORD 'sge_api';
    END IF;
END $$;

GRANT app_gestao TO sge_api;
GRANT USAGE ON SCHEMA gestao TO sge_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA gestao TO sge_api;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA gestao TO sge_api;
ALTER DEFAULT PRIVILEGES IN SCHEMA gestao
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sge_api;

-- -----------------------------------------------------------------------------
-- 6. Verificacao
-- -----------------------------------------------------------------------------
DO $$
DECLARE v_falhas int := 0;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema='gestao' AND table_name='usuario'
                      AND column_name='super_admin') THEN
        RAISE WARNING 'usuario.super_admin ausente'; v_falhas := v_falhas + 1;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc
                WHERE pronamespace='gestao'::regnamespace AND proconfig IS NULL) THEN
        RAISE WARNING 'ha funcoes sem search_path'; v_falhas := v_falhas + 1;
    END IF;
    IF v_falhas = 0 THEN
        RAISE NOTICE 'Ajustes aplicados com sucesso.';
    END IF;
END $$;
