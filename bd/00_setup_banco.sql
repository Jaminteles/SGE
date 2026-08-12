-- =============================================================================
-- 00_setup_banco.sql
-- Preparacao do banco antes dos scripts de schema.
-- Executar como superusuario (postgres), conectado a QUALQUER banco:
--   psql -U postgres -f 00_setup_banco.sql
--
-- ############################################################################
-- ATENCAO: ESTE SCRIPT APAGA O BANCO gestao_empresarial E TODOS OS SEUS DADOS.
-- Ele recria o ambiente do zero. NAO rode em base com dados que importam.
-- ############################################################################
--
-- Por que dropar: os scripts 01 a 07 nao sao um sistema de migracao -- eles
-- montam o schema do zero. Reexecutar sobre um banco existente falharia no
-- primeiro CREATE TABLE. Recriar e o caminho previsto para desenvolvimento.
--
-- Idempotente: pode ser reexecutado quantas vezes for preciso.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Remover o banco existente
--
-- WITH (FORCE) derruba as conexoes abertas (PostgreSQL 13+). Sem isso, uma
-- sessao esquecida no pgAdmin ou a propria API rodando impediria o DROP.
-- -----------------------------------------------------------------------------
DROP DATABASE IF EXISTS gestao_empresarial WITH (FORCE);

-- -----------------------------------------------------------------------------
-- 2. Remover as roles criadas pelos scripts de schema
--
-- Roles sao do cluster, nao do banco: sobrevivem ao DROP DATABASE. E 03 executa
-- "CREATE ROLE app_gestao" sem condicional -- reinstalar sem limpar aqui pararia
-- exatamente na configuracao da RLS.
--
-- Ordem importa: primeiro o banco, depois as roles. Enquanto o banco existir,
-- elas ainda detem privilegios la dentro e o DROP ROLE e recusado.
-- -----------------------------------------------------------------------------
DROP ROLE IF EXISTS sge_api;      -- criada em 04, usada pela API (sujeita a RLS)
DROP ROLE IF EXISTS app_gestao;   -- criada em 03, agrupa os privilegios da RLS

-- -----------------------------------------------------------------------------
-- 3. Role dona do schema
--
-- CREATEROLE e necessario porque 03_schema_contabil_governanca.sql executa
-- "CREATE ROLE app_gestao NOLOGIN" ao configurar a RLS.
--
-- gestao_owner NAO e recriada: ela pode ser dona de objetos em outros bancos do
-- cluster, e o DROP falharia. Se ja existir, apenas a senha e os atributos sao
-- reaplicados -- o que tambem serve para redefinir a senha esquecida.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gestao_owner') THEN
        ALTER ROLE gestao_owner WITH LOGIN CREATEROLE PASSWORD 'troque_esta_senha';
        RAISE NOTICE 'Role gestao_owner ja existia: senha e atributos reaplicados.';
    ELSE
        CREATE ROLE gestao_owner WITH LOGIN CREATEROLE PASSWORD 'troque_esta_senha';
        RAISE NOTICE 'Role gestao_owner criada.';
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 4. Criar o banco
-- -----------------------------------------------------------------------------
CREATE DATABASE gestao_empresarial OWNER gestao_owner;

-- A partir daqui, conectar como gestao_owner:
--   psql -U gestao_owner -h localhost -d gestao_empresarial -f 01_schema_core.sql
--   ... ate 07_parceiros_produtos_sprint4.sql
--
-- As quatro extensoes usadas (pgcrypto, pg_trgm, btree_gist, unaccent) sao
-- "trusted" no PostgreSQL 13+, entao o proprio gestao_owner consegue cria-las.
-- Nao e preciso rodar os scripts de schema como superusuario -- e melhor NAO
-- rodar, porque superusuario ignora RLS e o smoke test deixaria de valida-la.
--
-- Troque as senhas padrao antes de sair do ambiente de desenvolvimento:
--   ALTER ROLE gestao_owner WITH PASSWORD '<senha forte>';
--   ALTER ROLE sge_api      WITH PASSWORD '<senha forte>';   -- apos rodar 04
