-- =============================================================================
-- 07_parceiros_produtos_sprint4.sql
-- Sprint 4 - Fase 2 (Cadastros): M04 - Clientes e Fornecedores (RF-022 a RF-027)
-- e M05 - Produtos e Servicos (RF-028 a RF-030).
--
-- Executar como gestao_owner, depois de 01 a 06:
--   psql -U gestao_owner -h localhost -d gestao_empresarial -f 07_parceiros_produtos_sprint4.sql
-- Idempotente: pode ser reexecutado.
--
-- O que 01 ja entregava: as tabelas do M04/M05 (parceiro, cliente, fornecedor,
-- contato, forma_pagamento, condicao_pagamento, unidade_medida,
-- categoria_produto, produto, produto_fornecedor) e a RLS por empresa aplicada
-- a todas elas (03). Este script fecha o que faltava para os requisitos da
-- sprint:
--   1. RN-010  - trilha de auditoria nas entidades de cadastro que ficaram fora
--   2. RN-001  - referencias entre tabelas presas a mesma empresa (FK composta)
--   3. RF-022/RF-023 - papel e perfil coerentes: so existe linha de cliente ou
--                fornecedor para quem exerce o papel
--   4. RF-024  - um unico endereco, contato e dado bancario principal por
--                parceiro
--   5. RF-026  - condicao de pagamento aritmeticamente valida
--   6. RF-027  - vinculo so com fornecedor, e um preferencial por item
--   7. RF-029/RF-030 - hierarquia de categorias sem ciclo, precos nao negativos
--                e dados fiscais no formato exigido pela NF-e/NFS-e
-- =============================================================================
SET search_path = gestao, public;

-- -----------------------------------------------------------------------------
-- 1. RN-010: auditoria das entidades de cadastro
--
-- 03 ja audita `parceiro` e `produto`. Ficaram de fora exatamente as tabelas
-- que carregam o que se negocia: limite de credito, bloqueio, condicao de
-- pagamento, preco de referencia do fornecedor e o proprio dado bancario do
-- parceiro (RF-114 a RF-116).
-- -----------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'cliente','fornecedor','contato','endereco','forma_pagamento',
        'condicao_pagamento','unidade_medida','categoria_produto','produto_fornecedor'
    ] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_auditoria ON gestao.%1$I;', t);
        EXECUTE format(
            'CREATE TRIGGER trg_%1$s_auditoria AFTER INSERT OR UPDATE OR DELETE ON gestao.%1$I
             FOR EACH ROW EXECUTE FUNCTION gestao.fn_auditoria_generica();', t);
    END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 2. RN-001: referencia cruzada entre empresas
--
-- Mesma tecnica de 06: chave candidata (empresa_id, id) no destino e FK composta
-- (empresa_id, <coluna>) na origem. Sem isso, um produto da empresa A poderia
-- apontar para a unidade de medida da empresa B -- a verificacao de FK roda no
-- sistema, sem RLS.
--
-- Onde 01 declarava ON DELETE SET NULL vale RESTRICT: FK composta nao aceita a
-- clausula por coluna no PostgreSQL 14, e a API ja inativa em vez de remover.
-- -----------------------------------------------------------------------------
-- 2.1 Chave candidata (empresa_id, id) nas tabelas referenciadas.
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'parceiro','produto','forma_pagamento','condicao_pagamento',
        'unidade_medida','categoria_produto'
    ] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_constraint
                        WHERE conrelid = format('gestao.%I', t)::regclass
                          AND conname  = format('uq_%s_tenant', t)) THEN
            EXECUTE format(
                'ALTER TABLE gestao.%1$I ADD CONSTRAINT uq_%1$s_tenant UNIQUE (empresa_id, id);', t);
        END IF;
    END LOOP;
END $$;

-- 2.2 Troca das FKs de coluna unica por FKs compostas com empresa_id.
DO $$
DECLARE
    r  record;
    c  record;
BEGIN
    FOR r IN
        SELECT * FROM (VALUES
            ('endereco',          'parceiro_id',                    'parceiro',            'CASCADE'),
            ('endereco',          'filial_id',                      'filial',              'CASCADE'),
            ('contato',           'parceiro_id',                    'parceiro',            'CASCADE'),
            ('contato',           'filial_id',                      'filial',              'CASCADE'),
            ('dado_bancario',     'parceiro_id',                    'parceiro',            'CASCADE'),
            ('cliente',           'parceiro_id',                    'parceiro',            'CASCADE'),
            ('cliente',           'condicao_pagamento_id',          'condicao_pagamento',  'RESTRICT'),
            ('cliente',           'forma_pagamento_id',             'forma_pagamento',     'RESTRICT'),
            ('cliente',           'vendedor_id',                    'funcionario',         'RESTRICT'),
            ('fornecedor',        'parceiro_id',                    'parceiro',            'CASCADE'),
            ('fornecedor',        'condicao_pagamento_id',          'condicao_pagamento',  'RESTRICT'),
            ('fornecedor',        'forma_pagamento_id',             'forma_pagamento',     'RESTRICT'),
            ('fornecedor',        'categoria_financeira_padrao_id', 'categoria_financeira','RESTRICT'),
            ('categoria_produto', 'categoria_pai_id',               'categoria_produto',   'RESTRICT'),
            ('produto',           'categoria_produto_id',           'categoria_produto',   'RESTRICT'),
            ('produto',           'unidade_medida_id',              'unidade_medida',      'RESTRICT'),
            ('produto_fornecedor','produto_id',                     'produto',             'CASCADE'),
            ('produto_fornecedor','parceiro_id',                    'parceiro',            'CASCADE')
        ) AS t(tabela, coluna, referencia, acao)
    LOOP
        -- Remove a FK de coluna unica herdada de 01 (nome gerado pelo servidor).
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
-- 3. RF-022 / RF-023: papel e perfil coerentes
--
-- `parceiro.eh_cliente`/`eh_fornecedor` dizem o que a pessoa e; `cliente` e
-- `fornecedor` guardam o que foi negociado em cada papel. Uma linha de
-- fornecedor para quem nunca vendeu nada produziria pedido de compra contra o
-- parceiro errado -- e o erro so apareceria no recebimento.
--
-- A verificacao e do banco, e nao so do service, porque e a garantia que
-- sobrevive a qualquer caminho de escrita (carga, correcao manual, outro app).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_valida_papel_parceiro() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_coluna text := TG_ARGV[0];   -- eh_cliente | eh_fornecedor
    v_papel  text := TG_ARGV[1];   -- rotulo usado na mensagem
    v_ok     boolean;
BEGIN
    EXECUTE format('SELECT p.%I FROM gestao.parceiro p WHERE p.id = $1', v_coluna)
    INTO v_ok USING NEW.parceiro_id;

    IF v_ok IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'O parceiro % nao exerce o papel de % (RF-022/RF-023).',
            NEW.parceiro_id, v_papel;
    END IF;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_valida_papel_parceiro() IS
    'RF-022/RF-023 - perfil de cliente/fornecedor exige o papel correspondente no parceiro.';

DROP TRIGGER IF EXISTS trg_cliente_papel ON cliente;
CREATE TRIGGER trg_cliente_papel
    BEFORE INSERT OR UPDATE ON cliente
    FOR EACH ROW EXECUTE FUNCTION fn_valida_papel_parceiro('eh_cliente', 'cliente');

DROP TRIGGER IF EXISTS trg_fornecedor_papel ON fornecedor;
CREATE TRIGGER trg_fornecedor_papel
    BEFORE INSERT OR UPDATE ON fornecedor
    FOR EACH ROW EXECUTE FUNCTION fn_valida_papel_parceiro('eh_fornecedor', 'fornecedor');

-- RF-027: o vinculo com o item so aceita quem fornece.
DROP TRIGGER IF EXISTS trg_produto_fornecedor_papel ON produto_fornecedor;
CREATE TRIGGER trg_produto_fornecedor_papel
    BEFORE INSERT OR UPDATE ON produto_fornecedor
    FOR EACH ROW EXECUTE FUNCTION fn_valida_papel_parceiro('eh_fornecedor', 'fornecedor');

-- Bloqueio sem motivo nao e revisavel: quem bloqueou some, o motivo tambem, e
-- o parceiro fica travado sem ninguem saber por que.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.cliente'::regclass
                      AND conname = 'ck_cliente_bloqueio') THEN
        ALTER TABLE cliente ADD CONSTRAINT ck_cliente_bloqueio
            CHECK (NOT bloqueado OR motivo_bloqueio IS NOT NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.fornecedor'::regclass
                      AND conname = 'ck_fornecedor_bloqueio') THEN
        ALTER TABLE fornecedor ADD CONSTRAINT ck_fornecedor_bloqueio
            CHECK (NOT bloqueado OR motivo_bloqueio IS NOT NULL);
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 4. RF-024: um principal por parceiro
--
-- Endereco de cobranca, contato e conta de credito: quando ha dois marcados
-- como principal, quem escolhe passa a ser o `ORDER BY` de quem consulta.
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS ux_endereco_parceiro_principal
    ON endereco (parceiro_id) WHERE parceiro_id IS NOT NULL AND principal;

CREATE UNIQUE INDEX IF NOT EXISTS ux_contato_parceiro_principal
    ON contato (parceiro_id) WHERE parceiro_id IS NOT NULL AND principal;

CREATE UNIQUE INDEX IF NOT EXISTS ux_dado_bancario_parceiro_principal
    ON dado_bancario (parceiro_id) WHERE parceiro_id IS NOT NULL AND principal;

-- A mesma regra vale para o funcionario (M03), onde a API ja a aplicava sozinha.
CREATE UNIQUE INDEX IF NOT EXISTS ux_dado_bancario_funcionario_principal
    ON dado_bancario (funcionario_id) WHERE funcionario_id IS NOT NULL AND principal;

CREATE INDEX IF NOT EXISTS ix_contato_parceiro ON contato (parceiro_id);
CREATE INDEX IF NOT EXISTS ix_endereco_parceiro ON endereco (parceiro_id);
CREATE INDEX IF NOT EXISTS ix_parceiro_papel
    ON parceiro (empresa_id, eh_cliente, eh_fornecedor) WHERE ativo;

-- -----------------------------------------------------------------------------
-- 5. RF-026: condicao de pagamento valida
--
-- 01 ja exigia quantidade_parcelas > 0. Faltava o resto da aritmetica: um
-- intervalo zero colocaria todas as parcelas no mesmo vencimento, e um desconto
-- acima de 100% inverteria o sinal do titulo gerado pelo M08.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.condicao_pagamento'::regclass
                      AND conname = 'ck_condicao_prazos') THEN
        ALTER TABLE condicao_pagamento ADD CONSTRAINT ck_condicao_prazos
            CHECK (intervalo_dias > 0
               AND dias_primeira_parcela >= 0
               AND percentual_desconto >= 0
               AND percentual_desconto <= 100);
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 6. RF-027: um fornecedor preferencial por item
--
-- O preferencial e o que a cotacao usa como referencia; dois "preferenciais"
-- deixam a escolha para o acaso da ordenacao.
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS ux_produto_fornecedor_preferencial
    ON produto_fornecedor (produto_id) WHERE preferencial;

CREATE INDEX IF NOT EXISTS ix_produto_fornecedor_parceiro
    ON produto_fornecedor (parceiro_id);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.produto_fornecedor'::regclass
                      AND conname = 'ck_produto_fornecedor_valores') THEN
        ALTER TABLE produto_fornecedor ADD CONSTRAINT ck_produto_fornecedor_valores
            CHECK ((preco_referencia IS NULL OR preco_referencia >= 0)
               AND (prazo_entrega_dias IS NULL OR prazo_entrega_dias >= 0));
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 7. RF-029 / RF-030: catalogo consistente
-- -----------------------------------------------------------------------------

-- 7.1 Hierarquia de categorias sem ciclo (mesma funcao de 06, RF-014).
DROP TRIGGER IF EXISTS trg_categoria_produto_hierarquia ON categoria_produto;
CREATE TRIGGER trg_categoria_produto_hierarquia
    BEFORE INSERT OR UPDATE OF categoria_pai_id ON categoria_produto
    FOR EACH ROW EXECUTE FUNCTION fn_valida_ciclo_hierarquia('categoria_pai_id');

-- 7.2 Precificacao: 01 ja garante estoque_maximo >= estoque_minimo e o formato
-- do NCM. Falta impedir preco e peso negativos -- que passariam direto para o
-- item da nota e para o custo medio.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.produto'::regclass
                      AND conname = 'ck_produto_valores') THEN
        ALTER TABLE produto ADD CONSTRAINT ck_produto_valores
            CHECK ((preco_venda IS NULL OR preco_venda >= 0)
               AND custo_medio >= 0
               AND (custo_ultima_compra IS NULL OR custo_ultima_compra >= 0)
               AND (margem_padrao IS NULL OR margem_padrao >= 0)
               AND estoque_minimo >= 0
               AND (peso_liquido IS NULL OR peso_liquido >= 0)
               AND (peso_bruto   IS NULL OR peso_bruto   >= 0));
    END IF;
END $$;

-- 7.3 Dados fiscais (RF-030): CEST, CFOP e origem tem formato fixo na NF-e, e
-- servico so e classificavel na NFS-e com o codigo da LC 116.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.produto'::regclass
                      AND conname = 'ck_produto_fiscal') THEN
        ALTER TABLE produto ADD CONSTRAINT ck_produto_fiscal
            CHECK ((cest IS NULL OR cest ~ '^[0-9]{7}$')
               AND (cfop_padrao_entrada IS NULL OR cfop_padrao_entrada ~ '^[0-9]{4}$')
               AND (cfop_padrao_saida   IS NULL OR cfop_padrao_saida   ~ '^[0-9]{4}$')
               AND (origem_mercadoria IS NULL OR origem_mercadoria BETWEEN 0 AND 8)
               AND (tipo <> 'SERVICO' OR codigo_servico_lc116 IS NOT NULL));
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 8. RF-025: consulta do historico do parceiro
--
-- O resumo soma titulos e pedidos por parceiro dentro de um periodo. Os indices
-- de 01/02 cobrem (parceiro_id, data DESC); falta o filtro por empresa, que e o
-- primeiro predicado aplicado pela RLS.
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS ix_titulo_empresa_parceiro
    ON titulo (empresa_id, parceiro_id, data_emissao DESC) WHERE parceiro_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_pedido_compra_empresa_parceiro
    ON pedido_compra (empresa_id, parceiro_id, data_pedido DESC);

-- -----------------------------------------------------------------------------
-- 9. Reaplica o search_path fixo exigido por 04 nas funcoes criadas aqui.
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
-- 10. Verificacao
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_falhas   int := 0;
    v_triggers int;
    v_fks      int;
    v_indices  int;
BEGIN
    SELECT count(*) INTO v_triggers
      FROM pg_trigger
     WHERE NOT tgisinternal
       AND tgname IN ('trg_cliente_papel','trg_fornecedor_papel',
                      'trg_produto_fornecedor_papel','trg_categoria_produto_hierarquia',
                      'trg_cliente_auditoria','trg_fornecedor_auditoria');
    IF v_triggers < 6 THEN
        RAISE WARNING 'regras do M04/M05 incompletas (% de 6)', v_triggers; v_falhas := v_falhas + 1;
    END IF;

    SELECT count(*) INTO v_fks
      FROM pg_constraint
     WHERE contype = 'f' AND conname LIKE 'fk\_%\_tenant';
    IF v_fks < 40 THEN
        RAISE WARNING 'FKs multiempresa incompletas (% de 40)', v_fks; v_falhas := v_falhas + 1;
    END IF;

    SELECT count(*) INTO v_indices
      FROM pg_indexes
     WHERE schemaname = 'gestao'
       AND indexname IN ('ux_endereco_parceiro_principal','ux_contato_parceiro_principal',
                         'ux_dado_bancario_parceiro_principal','ux_produto_fornecedor_preferencial');
    IF v_indices < 4 THEN
        RAISE WARNING 'unicidade de principal/preferencial incompleta (% de 4)', v_indices;
        v_falhas := v_falhas + 1;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_produto_fiscal') THEN
        RAISE WARNING 'validacao fiscal do produto ausente (RF-030)'; v_falhas := v_falhas + 1;
    END IF;

    IF v_falhas = 0 THEN
        RAISE NOTICE 'M04/M05 - Parceiros e Catalogo: ajustes aplicados com sucesso.';
    END IF;
END $$;
