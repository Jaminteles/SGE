-- =============================================================================
-- 00_setup_banco.sql
-- Preparacao do banco antes dos scripts de schema.
-- Executar como superusuario (postgres), conectado a QUALQUER banco.
--   psql -U postgres -f 00_setup_banco.sql
-- =============================================================================

-- Role dona do schema.
-- CREATEROLE e necessario porque 03_schema_contabil_governanca.sql
-- executa "CREATE ROLE app_gestao NOLOGIN" ao configurar a RLS.
CREATE ROLE gestao_owner WITH LOGIN CREATEROLE PASSWORD 'troque_esta_senha';

CREATE DATABASE gestao_empresarial OWNER gestao_owner;

-- A partir daqui, conectar como gestao_owner:
--   psql -U gestao_owner -h localhost -d gestao_empresarial -f 01_schema_core.sql
--
-- As quatro extensoes usadas (pgcrypto, pg_trgm, btree_gist, unaccent) sao
-- "trusted" no PostgreSQL 13+, entao o proprio gestao_owner consegue cria-las.
-- Nao e preciso rodar os scripts de schema como superusuario -- e melhor NAO
-- rodar, porque superusuario ignora RLS e o smoke test deixaria de valida-la.
