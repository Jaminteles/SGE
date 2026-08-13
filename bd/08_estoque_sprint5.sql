-- =============================================================================
-- 08_estoque_sprint5.sql
-- Sprint 5 - Fase 2 (Cadastros): M05 - Estoque (RF-031 a RF-035).
--
-- Executar como gestao_owner, depois de 01 a 07:
--   psql -U gestao_owner -h localhost -d gestao_empresarial -f 08_estoque_sprint5.sql
-- Idempotente: pode ser reexecutado.
--
-- O que 01/03 ja entregavam: as tabelas (local_estoque, estoque_saldo,
-- movimento_estoque, inventario, inventario_item), a view de alerta minimo, a
-- RLS por empresa e um trigger que projetava o saldo. Este script fecha o que
-- faltava para o estoque ser confiavel:
--   1. RN-010 - trilha de auditoria nas entidades do estoque
--   2. RN-001 - referencias presas a mesma empresa (FK composta)
--   3. RF-032 - o razao (movimento_estoque) e append-only, como a auditoria
--   4. RF-031/RF-034 - saldo e custo medio corretos: saldo anterior/posterior
--                gravados, custo medio ponderado coerente com o valor total,
--                saldo negativo recusado e `produto.custo_medio` projetado
--   5. RF-031 - um local padrao por filial; local inativo nao movimenta
--   6. RF-033 - numeracao, maquina de estados e imutabilidade do inventario
--   7. RF-035 - indice que sustenta a consulta de alerta de estoque minimo
--
-- Decisao estrutural: `estoque_saldo` deixa de ser gravavel pela aplicacao. A
-- unica porta de entrada do estoque passa a ser um INSERT no razao; o saldo e
-- projecao. Sem isso, um defeito (ou um abuso) na API poderia acertar o saldo
-- sem deixar o lancamento que o explica -- exatamente o que um controle de
-- estoque existe para impedir.
-- =============================================================================
SET search_path = gestao, public;

-- -----------------------------------------------------------------------------
-- 1. RN-010: auditoria das entidades do estoque
--
-- `estoque_saldo` fica de fora de proposito: ele muda a cada movimento e o
-- proprio razao ja e a trilha do estoque. Auditar a projecao dobraria o volume
-- da trilha sem acrescentar um fato novo.
-- -----------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'local_estoque','movimento_estoque','inventario','inventario_item'
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
-- Mesma tecnica de 06 e 07: chave candidata (empresa_id, id) no destino e FK
-- composta (empresa_id, <coluna>) na origem. A verificacao de FK roda no
-- sistema, sem RLS -- sem a coluna de empresa na chave, um movimento da empresa
-- A poderia debitar o local da empresa B.
-- -----------------------------------------------------------------------------
-- 2.1 Chave candidata (empresa_id, id) nas tabelas referenciadas aqui.
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['local_estoque','inventario','filial','produto'] LOOP
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
            ('local_estoque',     'filial_id',        'filial',        'CASCADE'),
            ('estoque_saldo',     'produto_id',       'produto',       'CASCADE'),
            ('estoque_saldo',     'local_estoque_id', 'local_estoque', 'CASCADE'),
            ('movimento_estoque', 'produto_id',       'produto',       'RESTRICT'),
            ('movimento_estoque', 'local_estoque_id', 'local_estoque', 'RESTRICT'),
            ('movimento_estoque', 'local_destino_id', 'local_estoque', 'RESTRICT'),
            ('inventario',        'local_estoque_id', 'local_estoque', 'RESTRICT'),
            ('inventario_item',   'inventario_id',    'inventario',    'CASCADE'),
            ('inventario_item',   'produto_id',       'produto',       'RESTRICT')
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
-- 3. RF-032: o razao do estoque e append-only
--
-- Mesma regra da trilha de auditoria (RF-118), pelo mesmo motivo: se o
-- lancamento pode ser reescrito, o saldo deixa de ser explicavel. Estorno se faz
-- com movimento contrario, nao com UPDATE.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_bloqueia_alteracao_movimento_estoque() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Movimento de estoque nao pode ser alterado ou removido (RF-032). Lance o movimento contrario.';
END;
$$;

DROP TRIGGER IF EXISTS trg_movimento_estoque_imutavel ON movimento_estoque;
CREATE TRIGGER trg_movimento_estoque_imutavel
    BEFORE UPDATE OR DELETE ON movimento_estoque
    FOR EACH ROW EXECUTE FUNCTION fn_bloqueia_alteracao_movimento_estoque();

-- -----------------------------------------------------------------------------
-- 4. RF-031 / RF-034: saldo e custo medio
--
-- 03 projetava o saldo num unico trigger AFTER INSERT que tinha tres problemas:
--   a) `saldo_anterior`/`saldo_posterior` do movimento nunca eram preenchidos --
--      o razao nao permitia reconstruir a posicao em uma data;
--   b) `valor_total` do saldo era calculado com o custo medio *antigo*, porque
--      dentro do SET a referencia `estoque_saldo.custo_medio` ainda vale o valor
--      anterior: o saldo ficava valorizado a um custo que nao era o dele;
--   c) nada impedia saldo negativo, e um saldo negativo envenena o custo medio
--      (a media ponderada passa a dividir por uma quantidade sem significado).
--
-- Agora sao dois triggers, cada um com uma responsabilidade:
--   BEFORE - valida, serializa e calcula o que o movimento registra;
--   AFTER  - aplica a projecao em `estoque_saldo` e em `produto.custo_medio`.
-- -----------------------------------------------------------------------------

-- 4.1 Sinal do movimento, em um lugar so.
CREATE OR REPLACE FUNCTION fn_sinal_movimento_estoque(p_tipo enum_tipo_mov_estoque)
RETURNS smallint
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE p_tipo
        WHEN 'ENTRADA'               THEN  1
        WHEN 'TRANSFERENCIA_ENTRADA' THEN  1
        WHEN 'AJUSTE_POSITIVO'       THEN  1
        WHEN 'SAIDA'                 THEN -1
        WHEN 'TRANSFERENCIA_SAIDA'   THEN -1
        WHEN 'AJUSTE_NEGATIVO'       THEN -1
    END::smallint;
$$;

COMMENT ON FUNCTION fn_sinal_movimento_estoque(enum_tipo_mov_estoque) IS
    'RF-032 - direcao do movimento no saldo. NULL para INVENTARIO, que nao e lancavel.';

COMMENT ON COLUMN movimento_estoque.local_destino_id IS
    'RF-032 - contraparte da transferencia: na perna de saida e o local que '
    'recebe; na de entrada, o local que enviou.';

-- 4.2 BEFORE: valida, serializa por (produto, local) e calcula saldo e valor.
CREATE OR REPLACE FUNCTION fn_prepara_movimento_estoque() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_sinal     smallint;
    v_produto   record;
    v_local     record;
    v_saldo     record;
    v_anterior  dom_quantidade := 0;
    v_custo     dom_valor_unit := 0;
BEGIN
    v_sinal := fn_sinal_movimento_estoque(NEW.tipo);

    -- 'INVENTARIO' existe no enum de 01 mas nao tem direcao: aplicado como
    -- estava, produzia um lancamento de delta zero -- uma linha no razao que
    -- nao mexe no saldo e some da conferencia. O ajuste apurado na contagem e
    -- lancado como AJUSTE_POSITIVO/AJUSTE_NEGATIVO com origem_tipo
    -- 'INVENTARIO', que diz a mesma coisa sem ambiguidade de sinal.
    IF v_sinal IS NULL THEN
        RAISE EXCEPTION 'Movimento do tipo % nao e lancavel: use AJUSTE_POSITIVO ou AJUSTE_NEGATIVO com origem_tipo = ''INVENTARIO'' (RF-033).', NEW.tipo;
    END IF;

    SELECT p.controla_estoque, p.ativo, p.codigo
      INTO v_produto
      FROM produto p
     WHERE p.id = NEW.produto_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Produto % nao encontrado nesta empresa.', NEW.produto_id;
    END IF;
    IF NOT v_produto.controla_estoque THEN
        RAISE EXCEPTION 'O item % nao controla estoque e nao pode ser movimentado (RF-031).', v_produto.codigo;
    END IF;
    IF NOT v_produto.ativo THEN
        RAISE EXCEPTION 'O item % esta inativo e nao pode ser movimentado.', v_produto.codigo;
    END IF;

    SELECT l.ativo, l.codigo INTO v_local FROM local_estoque l WHERE l.id = NEW.local_estoque_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Local de estoque % nao encontrado nesta empresa.', NEW.local_estoque_id;
    END IF;
    IF NOT v_local.ativo THEN
        RAISE EXCEPTION 'O local de estoque % esta inativo e nao aceita movimento.', v_local.codigo;
    END IF;

    IF NEW.local_destino_id IS NOT NULL AND NEW.local_destino_id = NEW.local_estoque_id THEN
        RAISE EXCEPTION 'A transferencia exige locais de origem e destino diferentes (RF-032).';
    END IF;

    -- Serializa quem mexe no mesmo par produto/local. Sem isso, dois movimentos
    -- simultaneos leriam o mesmo saldo anterior e gravariam saldo posterior
    -- incoerente -- e a checagem de saldo negativo abaixo poderia ser vencida
    -- por duas saidas concorrentes. O lock e por transacao: liberado no commit.
    PERFORM pg_advisory_xact_lock(
        hashtext('estoque:' || NEW.produto_id::text || ':' || NEW.local_estoque_id::text));

    SELECT s.quantidade, s.custo_medio INTO v_saldo
      FROM estoque_saldo s
     WHERE s.produto_id = NEW.produto_id
       AND s.local_estoque_id = NEW.local_estoque_id;

    IF FOUND THEN
        v_anterior := v_saldo.quantidade;
        v_custo    := v_saldo.custo_medio;
    END IF;

    -- Saida sem custo informado sai pelo custo medio do local: e o que a
    -- media ponderada exige para nao alterar o custo do que ficou.
    IF v_sinal < 0 AND coalesce(NEW.custo_unitario, 0) = 0 THEN
        NEW.custo_unitario := v_custo;
    END IF;

    NEW.saldo_anterior  := v_anterior;
    NEW.saldo_posterior := v_anterior + (v_sinal * NEW.quantidade);
    NEW.valor_total     := NEW.quantidade * NEW.custo_unitario;

    IF NEW.saldo_posterior < 0 THEN
        RAISE EXCEPTION 'Saldo insuficiente de % no local %: disponivel %, movimento % (RF-031).',
            v_produto.codigo, v_local.codigo, v_anterior, NEW.quantidade;
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_prepara_movimento_estoque() IS
    'RF-031/RF-032 - valida o movimento, serializa o par produto/local e grava saldo anterior/posterior.';

-- 4.3 AFTER: projeta o saldo do local e o custo medio do item.
--
-- SECURITY DEFINER porque `estoque_saldo` deixa de ser gravavel pela role da
-- aplicacao (secao 8): a projecao passa a ser alcancavel *somente* por este
-- caminho. A funcao continua sujeita a RLS -- gestao_owner tem FORCE ROW LEVEL
-- SECURITY (03) -- e o search_path e fixo, sem o que um schema no caminho de
-- busca poderia sequestrar as chamadas nao qualificadas.
CREATE OR REPLACE FUNCTION fn_aplica_movimento_estoque() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = gestao, public AS $$
DECLARE
    v_delta    dom_quantidade := NEW.saldo_posterior - NEW.saldo_anterior;
    v_anterior dom_valor_unit;
    v_custo    dom_valor_unit;
    v_final    dom_valor_unit;
BEGIN
    -- O saldo ainda nao foi atualizado (o UPSERT abaixo e que o faz): esta
    -- leitura devolve o custo medio vigente antes do movimento.
    SELECT s.custo_medio INTO v_anterior
      FROM estoque_saldo s
     WHERE s.produto_id = NEW.produto_id
       AND s.local_estoque_id = NEW.local_estoque_id;

    -- Media ponderada movel: so a entrada altera o custo. A saida leva embora
    -- quantidade ao custo que ja estava formado; se alterasse a media, o custo
    -- do que ficou no estoque dependeria da ordem das vendas.
    IF v_delta > 0 AND NEW.saldo_posterior > 0 THEN
        v_custo := ((NEW.saldo_anterior * coalesce(v_anterior, 0))
                    + (v_delta * NEW.custo_unitario))
                   / NEW.saldo_posterior;
    ELSE
        v_custo := NULL;   -- mantem o custo corrente
    END IF;

    -- Sem entrada nova, vale o custo que ja estava formado; sem saldo anterior
    -- (primeiro movimento do par), o do proprio lancamento.
    v_final := coalesce(v_custo, v_anterior, NEW.custo_unitario);

    -- `EXCLUDED` em vez de repetir as expressoes: o valor gravado no conflito e
    -- exatamente o mesmo que o INSERT propos, e nao uma segunda formula que
    -- possa divergir da primeira em uma edicao futura.
    INSERT INTO estoque_saldo (empresa_id, produto_id, local_estoque_id,
                               quantidade, custo_medio, valor_total)
    VALUES (NEW.empresa_id, NEW.produto_id, NEW.local_estoque_id,
            NEW.saldo_posterior, v_final, NEW.saldo_posterior * v_final)
    ON CONFLICT (produto_id, local_estoque_id) DO UPDATE
       SET quantidade    = EXCLUDED.quantidade,
           custo_medio   = EXCLUDED.custo_medio,
           valor_total   = EXCLUDED.valor_total,
           atualizado_em = now();

    -- RF-034: `produto.custo_medio` e o custo da empresa, nao o de um local --
    -- e o numero que a valorizacao e o CMV usam. Recalculado a partir dos
    -- saldos; com estoque zerado o ultimo custo formado e preservado, porque
    -- zerar o custo faria a proxima entrada parecer lucro integral.
    UPDATE produto p
       SET custo_medio = sub.custo
      FROM (
            SELECT CASE WHEN sum(s.quantidade) > 0
                        THEN sum(s.valor_total) / sum(s.quantidade)
                   END AS custo
              FROM estoque_saldo s
             WHERE s.produto_id = NEW.produto_id
           ) sub
     WHERE p.id = NEW.produto_id
       AND sub.custo IS NOT NULL;

    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION fn_aplica_movimento_estoque() IS
    'RF-031/RF-034 - projeta o saldo do local e o custo medio ponderado do item.';

DROP TRIGGER IF EXISTS trg_prepara_movimento_estoque ON movimento_estoque;
CREATE TRIGGER trg_prepara_movimento_estoque
    BEFORE INSERT ON movimento_estoque
    FOR EACH ROW EXECUTE FUNCTION fn_prepara_movimento_estoque();

DROP TRIGGER IF EXISTS trg_aplica_movimento_estoque ON movimento_estoque;
CREATE TRIGGER trg_aplica_movimento_estoque
    AFTER INSERT ON movimento_estoque
    FOR EACH ROW EXECUTE FUNCTION fn_aplica_movimento_estoque();

-- 4.4 Barreiras declarativas: o que o trigger calcula, o CHECK confere.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.estoque_saldo'::regclass
                      AND conname = 'ck_estoque_saldo_quantidade') THEN
        ALTER TABLE estoque_saldo ADD CONSTRAINT ck_estoque_saldo_quantidade
            CHECK (quantidade >= 0
               AND quantidade_reservada >= 0
               AND quantidade_reservada <= quantidade
               AND custo_medio >= 0);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.movimento_estoque'::regclass
                      AND conname = 'ck_movimento_custo') THEN
        ALTER TABLE movimento_estoque ADD CONSTRAINT ck_movimento_custo
            CHECK (custo_unitario >= 0 AND valor_total >= 0);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.movimento_estoque'::regclass
                      AND conname = 'ck_movimento_locais_distintos') THEN
        ALTER TABLE movimento_estoque ADD CONSTRAINT ck_movimento_locais_distintos
            CHECK (local_destino_id IS NULL OR local_destino_id <> local_estoque_id);
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 5. RF-031: locais de estoque
--
-- O local padrao e o destino assumido quando o recebimento (M06) ou a nota
-- (M07) nao dizem onde guardar. Dois padroes na mesma filial deixam essa
-- escolha para o `ORDER BY` de quem consulta -- mesma razao do "principal" do
-- parceiro em 07.
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS ux_local_estoque_padrao
    ON local_estoque (filial_id) WHERE padrao;

CREATE INDEX IF NOT EXISTS ix_local_estoque_empresa
    ON local_estoque (empresa_id, filial_id) WHERE ativo;

-- -----------------------------------------------------------------------------
-- 6. RF-033: inventario
-- -----------------------------------------------------------------------------

-- 6.1 Numeracao sequencial por empresa e ano (mesma tecnica do reembolso, 06).
CREATE OR REPLACE FUNCTION fn_proximo_numero_inventario(p_empresa_id uuid)
RETURNS varchar
LANGUAGE plpgsql AS $$
DECLARE
    v_ano       text := to_char(current_date, 'YYYY');
    v_prefixo   text := 'INV-' || v_ano || '-';
    v_sequencia int;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('inventario:' || p_empresa_id::text));

    SELECT coalesce(max(substring(i.numero from '[0-9]+$')::int), 0) + 1
      INTO v_sequencia
      FROM inventario i
     WHERE i.empresa_id = p_empresa_id
       AND i.numero LIKE v_prefixo || '%';

    RETURN v_prefixo || lpad(v_sequencia::text, 6, '0');
END;
$$;

COMMENT ON FUNCTION fn_proximo_numero_inventario(uuid) IS
    'RF-033 - proximo numero de inventario da empresa no ano corrente.';

-- 6.2 Situacoes validas e coerencia da conclusao.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.inventario'::regclass
                      AND conname = 'ck_inventario_status') THEN
        ALTER TABLE inventario ADD CONSTRAINT ck_inventario_status
            CHECK (status IN ('ABERTO','EM_CONTAGEM','CONCLUIDO','CANCELADO'));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.inventario'::regclass
                      AND conname = 'ck_inventario_conclusao') THEN
        ALTER TABLE inventario ADD CONSTRAINT ck_inventario_conclusao
            CHECK ((status = 'CONCLUIDO') = (data_conclusao IS NOT NULL));
    END IF;
END $$;

-- 6.3 Uma contagem aberta por local.
--
-- Dois inventarios simultaneos no mesmo local apuram diferencas contra o mesmo
-- saldo e ajustam duas vezes a mesma sobra -- o segundo fechamento "corrige" o
-- que o primeiro ja corrigiu.
CREATE UNIQUE INDEX IF NOT EXISTS ux_inventario_local_aberto
    ON inventario (empresa_id, local_estoque_id)
    WHERE status IN ('ABERTO','EM_CONTAGEM');

-- 6.4 Maquina de estados (RF-033).
CREATE OR REPLACE FUNCTION fn_valida_status_inventario() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_permitido text[];
BEGIN
    IF NEW.status = OLD.status THEN
        RETURN NEW;
    END IF;

    v_permitido := CASE OLD.status
        WHEN 'ABERTO'      THEN ARRAY['EM_CONTAGEM','CANCELADO']
        WHEN 'EM_CONTAGEM' THEN ARRAY['CONCLUIDO','CANCELADO']
        ELSE ARRAY[]::text[]
    END;

    IF NOT (NEW.status = ANY (v_permitido)) THEN
        RAISE EXCEPTION 'Inventario % nao pode ir de % para % (RF-033).',
            OLD.numero, OLD.status, NEW.status;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inventario_status ON inventario;
CREATE TRIGGER trg_inventario_status
    BEFORE UPDATE ON inventario
    FOR EACH ROW EXECUTE FUNCTION fn_valida_status_inventario();

-- 6.5 Item: a quantidade do sistema e uma fotografia, e o inventario encerrado
-- nao aceita retoque.
--
-- `quantidade_sistema` e o saldo no instante da abertura: e contra ele que a
-- diferenca foi apurada e o ajuste, lancado. Reescrever esse numero depois
-- inventaria uma sobra ou uma falta que nunca existiu.
CREATE OR REPLACE FUNCTION fn_valida_item_inventario() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_inventario uuid;
    v_status     text;
    v_numero     text;
BEGIN
    -- Ramo explicito: em DELETE o registro NEW nao esta atribuido, e referenciar
    -- NEW.<coluna> ali aborta a funcao antes de qualquer validacao.
    IF TG_OP = 'DELETE' THEN
        v_inventario := OLD.inventario_id;
    ELSE
        v_inventario := NEW.inventario_id;
    END IF;

    SELECT i.status, i.numero INTO v_status, v_numero
      FROM inventario i
     WHERE i.id = v_inventario;

    IF v_status IN ('CONCLUIDO','CANCELADO') THEN
        RAISE EXCEPTION 'Inventario % esta % e nao aceita alteracao de itens (RF-033).',
            v_numero, v_status;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE' AND NEW.quantidade_sistema IS DISTINCT FROM OLD.quantidade_sistema THEN
        RAISE EXCEPTION 'A quantidade do sistema e o saldo apurado na abertura e nao pode ser alterada (RF-033).';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inventario_item_valida ON inventario_item;
CREATE TRIGGER trg_inventario_item_valida
    BEFORE INSERT OR UPDATE OR DELETE ON inventario_item
    FOR EACH ROW EXECUTE FUNCTION fn_valida_item_inventario();

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.inventario_item'::regclass
                      AND conname = 'ck_inventario_item_quantidades') THEN
        ALTER TABLE inventario_item ADD CONSTRAINT ck_inventario_item_quantidades
            CHECK (quantidade_sistema >= 0
               AND (quantidade_contada IS NULL OR quantidade_contada >= 0)
               AND (custo_unitario IS NULL OR custo_unitario >= 0));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_inventario_empresa_status
    ON inventario (empresa_id, status, data_inicio DESC);

CREATE INDEX IF NOT EXISTS ix_inventario_item_produto
    ON inventario_item (produto_id);

-- -----------------------------------------------------------------------------
-- 7. RF-035: alerta de estoque minimo
--
-- `vw_estoque_alerta_minimo` (01) filtra por empresa e compara saldo com
-- minimo. O indice cobre o predicado da RLS e o do proprio alerta.
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS ix_estoque_saldo_produto_local
    ON estoque_saldo (empresa_id, produto_id, local_estoque_id);

CREATE INDEX IF NOT EXISTS ix_estoque_saldo_local
    ON estoque_saldo (local_estoque_id);

CREATE INDEX IF NOT EXISTS ix_movimento_estoque_local
    ON movimento_estoque (empresa_id, local_estoque_id, data_movimento DESC);

-- -----------------------------------------------------------------------------
-- 8. Privilegios: o razao e a unica porta de entrada do estoque
--
-- `estoque_saldo` e projecao: quem tem UPDATE nele pode acertar o saldo sem o
-- lancamento que o explica, e a diferenca so aparece na proxima contagem.
-- Retirar o privilegio da role da aplicacao fecha esse caminho -- a projecao
-- passa a ser escrita apenas pelo trigger SECURITY DEFINER da secao 4.3.
--
-- Em `movimento_estoque` a retirada de UPDATE/DELETE e a segunda barreira do
-- append-only: um trigger pode ser desabilitado por quem tem direito sobre a
-- tabela; um GRANT ausente, nao.
-- -----------------------------------------------------------------------------
DO $$
DECLARE r text;
BEGIN
    FOREACH r IN ARRAY ARRAY['app_gestao', 'sge_api'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON gestao.estoque_saldo FROM %I;', r);
            EXECUTE format('GRANT SELECT ON gestao.estoque_saldo TO %I;', r);

            EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON gestao.movimento_estoque FROM %I;', r);
            EXECUTE format('GRANT SELECT, INSERT ON gestao.movimento_estoque TO %I;', r);

            EXECUTE format(
                'GRANT EXECUTE ON FUNCTION gestao.fn_proximo_numero_inventario(uuid) TO %I;', r);
            EXECUTE format('GRANT SELECT ON gestao.vw_estoque_alerta_minimo TO %I;', r);
        END IF;
    END LOOP;
END $$;

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
    v_gravavel int;
BEGIN
    SELECT count(*) INTO v_triggers
      FROM pg_trigger
     WHERE NOT tgisinternal
       AND tgname IN ('trg_prepara_movimento_estoque','trg_aplica_movimento_estoque',
                      'trg_movimento_estoque_imutavel','trg_inventario_status',
                      'trg_inventario_item_valida','trg_movimento_estoque_auditoria');
    IF v_triggers < 6 THEN
        RAISE WARNING 'regras do estoque incompletas (% de 6)', v_triggers; v_falhas := v_falhas + 1;
    END IF;

    SELECT count(*) INTO v_fks
      FROM pg_constraint
     WHERE contype = 'f' AND conname LIKE 'fk\_%\_tenant';
    IF v_fks < 49 THEN
        RAISE WARNING 'FKs multiempresa incompletas (% de 49)', v_fks; v_falhas := v_falhas + 1;
    END IF;

    SELECT count(*) INTO v_indices
      FROM pg_indexes
     WHERE schemaname = 'gestao'
       AND indexname IN ('ux_local_estoque_padrao','ux_inventario_local_aberto');
    IF v_indices < 2 THEN
        RAISE WARNING 'unicidade de local padrao/contagem aberta incompleta (% de 2)', v_indices;
        v_falhas := v_falhas + 1;
    END IF;

    SELECT count(*) INTO v_gravavel
      FROM information_schema.table_privileges
     WHERE table_schema = 'gestao'
       AND table_name IN ('estoque_saldo','movimento_estoque')
       AND grantee IN ('app_gestao','sge_api')
       AND privilege_type IN ('UPDATE','DELETE');
    IF v_gravavel > 0 THEN
        RAISE WARNING 'saldo/razao ainda gravaveis pela aplicacao (% privilegios)', v_gravavel;
        v_falhas := v_falhas + 1;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_proc
                    WHERE pronamespace = 'gestao'::regnamespace
                      AND proname = 'fn_proximo_numero_inventario') THEN
        RAISE WARNING 'numeracao do inventario ausente (RF-033)'; v_falhas := v_falhas + 1;
    END IF;

    IF v_falhas = 0 THEN
        RAISE NOTICE 'M05 - Estoque: ajustes aplicados com sucesso.';
    END IF;
END $$;
