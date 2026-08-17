-- =============================================================================
-- 11_compras_sprint8.sql
-- Sprint 8 - Fase 4 (Compras e Documentos): M06 - Compras (RF-036 a RF-042).
--
-- Executar como gestao_owner, depois de 01 a 10:
--   psql -U gestao_owner -h localhost -d gestao_empresarial -f 11_compras_sprint8.sql
-- Idempotente: pode ser reexecutado.
--
-- O que 02/03 ja entregavam: as tabelas (pedido_compra, pedido_compra_item,
-- recebimento, recebimento_item), a RLS por empresa e a auditoria dos dois
-- cabecalhos. Este script fecha o que faltava para compras ser confiavel:
--   1. RN-010 - trilha de auditoria tambem nos itens
--   2. RN-001 - referencias presas a mesma empresa (FK composta)
--   3. RF-036 - numeracao sequencial do pedido e do recebimento por empresa/ano
--   4. RF-037 - o pedido e a soma dos seus itens, com frete e despesas rateados
--   5. RF-038 - maquina de estados do pedido e da aprovacao; item so muda no
--                rascunho, porque aprovar um valor que depois muda nao e aprovar
--   6. RF-039 - o recebimento e append-only e nunca passa do que foi pedido
--   7. RF-040 - divergencia de quantidade e preco apurada no modelo
--   8. RF-041 - vinculo com estoque e financeiro sem duplicidade (RN-004)
--   9. RF-042 - historico de compras e de precos como visao do modelo
--
-- Decisao estrutural: a mesma dos modulos anteriores. `quantidade_recebida` do
-- item, o total do pedido, o status do pedido e as marcas de "gerou estoque" e
-- "gerou financeiro" deixam de ser numeros que a aplicacao escreve e passam a
-- ser projecao dos fatos que os produzem -- os itens e os recebimentos. Existe
-- uma unica porta de entrada para "chegou mercadoria": o INSERT em
-- `recebimento_item`. Sem isso, "quanto ainda falta receber" vira um campo
-- editavel, e o primeiro acerto manual o separa do que foi entregue de verdade.
-- =============================================================================
SET search_path = gestao, public;

-- -----------------------------------------------------------------------------
-- 1. RN-010: auditoria dos itens
--
-- `pedido_compra` e `recebimento` ja sao auditados desde 03; os itens, nao. E
-- neles que estao o preco negociado e a quantidade conferida -- exatamente o que
-- alguem teria interesse em mudar depois do fato.
-- -----------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['pedido_compra_item','recebimento_item'] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_auditoria ON gestao.%1$I;', t);
        EXECUTE format(
            'CREATE TRIGGER trg_%1$s_auditoria AFTER INSERT OR UPDATE OR DELETE ON gestao.%1$I
             FOR EACH ROW EXECUTE FUNCTION gestao.fn_auditoria_generica();', t);
    END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 2. RN-001: referencia cruzada entre empresas
--
-- Mesma tecnica de 06 a 10: chave candidata (empresa_id, id) no destino e FK
-- composta (empresa_id, <coluna>) na origem. A verificacao de FK roda no
-- sistema, sem RLS -- sem a coluna de empresa na chave, um pedido da empresa A
-- poderia ser emitido contra o fornecedor da empresa B, ou receber no deposito
-- dela.
--
-- `titulo.pedido_compra_id` entra aqui, e nao em 09: e nesta sprint que a coluna
-- passa a ser preenchida (RF-041). `documento_fiscal_id` continua de fora --
-- e da Sprint 9, e entra com o modulo que o preenche.
-- -----------------------------------------------------------------------------
-- 2.1 Chave candidata (empresa_id, id) nas tabelas referenciadas aqui.
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'pedido_compra','pedido_compra_item','recebimento','filial','parceiro','funcionario',
        'produto','local_estoque','centro_custo','categoria_financeira',
        'forma_pagamento','condicao_pagamento'
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
--
-- Como nas sprints anteriores, o que era `ON DELETE SET NULL` vira `RESTRICT`:
-- o PostgreSQL 14 nao aceita SET NULL em FK composta. Aqui isso e o
-- comportamento correto -- um pedido nao deve perder em silencio o centro de
-- custo que o classifica nem o local onde a mercadoria foi recebida.
DO $$
DECLARE
    r record;
    c record;
BEGIN
    FOR r IN
        SELECT * FROM (VALUES
            ('pedido_compra',     'filial_id',               'filial',               'RESTRICT'),
            ('pedido_compra',     'parceiro_id',             'parceiro',             'RESTRICT'),
            ('pedido_compra',     'comprador_id',            'funcionario',          'RESTRICT'),
            ('pedido_compra',     'condicao_pagamento_id',   'condicao_pagamento',   'RESTRICT'),
            ('pedido_compra',     'forma_pagamento_id',      'forma_pagamento',      'RESTRICT'),
            ('pedido_compra',     'centro_custo_id',         'centro_custo',         'RESTRICT'),
            ('pedido_compra',     'categoria_financeira_id', 'categoria_financeira', 'RESTRICT'),
            ('pedido_compra_item','pedido_compra_id',        'pedido_compra',        'CASCADE'),
            ('pedido_compra_item','produto_id',              'produto',              'RESTRICT'),
            ('pedido_compra_item','centro_custo_id',         'centro_custo',         'RESTRICT'),
            ('pedido_compra_item','local_estoque_id',        'local_estoque',        'RESTRICT'),
            ('recebimento',       'filial_id',               'filial',               'RESTRICT'),
            ('recebimento',       'pedido_compra_id',        'pedido_compra',        'RESTRICT'),
            ('recebimento',       'local_estoque_id',        'local_estoque',        'RESTRICT'),
            ('recebimento_item',  'recebimento_id',          'recebimento',          'CASCADE'),
            ('recebimento_item',  'pedido_compra_item_id',   'pedido_compra_item',   'RESTRICT'),
            ('recebimento_item',  'produto_id',              'produto',              'RESTRICT'),
            ('titulo',            'pedido_compra_id',        'pedido_compra',        'RESTRICT')
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
-- 3. RF-036 / RF-038: colunas que faltavam e numeracao
--
-- 3.1 Quem decidiu, e quando.
--
-- O pedido tinha `status_aprovacao` mas nao guardava o autor da decisao: sem
-- isso, "quem autorizou esta compra" so existe na trilha, e a consulta ao
-- proprio pedido nao responde a pergunta que mais se faz sobre ele.
-- -----------------------------------------------------------------------------
ALTER TABLE pedido_compra ADD COLUMN IF NOT EXISTS aprovado_por uuid REFERENCES usuario(id) ON DELETE SET NULL;
ALTER TABLE pedido_compra ADD COLUMN IF NOT EXISTS aprovado_em  timestamptz;

COMMENT ON COLUMN pedido_compra.aprovado_por IS
    'RF-038 - usuario que aprovou ou reprovou o pedido; a data fica em aprovado_em.';

-- 3.2 Numeracao sequencial por empresa e ano.
--
-- Mesma tecnica do titulo (09), do reembolso (06) e do inventario (08). O
-- prefixo distingue os dois documentos a olho nu: PC para pedido de compra, RC
-- para recebimento. O advisory lock evita que dois pedidos simultaneos leiam o
-- mesmo maximo e disputem o mesmo numero.
CREATE OR REPLACE FUNCTION fn_proximo_numero_pedido_compra(p_empresa_id uuid)
RETURNS varchar
LANGUAGE plpgsql AS $$
DECLARE
    v_prefixo   text := 'PC-' || to_char(current_date, 'YYYY') || '-';
    v_sequencia int;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('pedido_compra:' || p_empresa_id::text));

    SELECT coalesce(max(substring(p.numero from '[0-9]+$')::int), 0) + 1
      INTO v_sequencia
      FROM pedido_compra p
     WHERE p.empresa_id = p_empresa_id
       AND p.numero LIKE v_prefixo || '%';

    RETURN v_prefixo || lpad(v_sequencia::text, 6, '0');
END;
$$;

COMMENT ON FUNCTION fn_proximo_numero_pedido_compra(uuid) IS
    'RF-036 - proximo numero de pedido de compra da empresa no ano corrente.';

CREATE OR REPLACE FUNCTION fn_proximo_numero_recebimento(p_empresa_id uuid)
RETURNS varchar
LANGUAGE plpgsql AS $$
DECLARE
    v_prefixo   text := 'RC-' || to_char(current_date, 'YYYY') || '-';
    v_sequencia int;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('recebimento:' || p_empresa_id::text));

    SELECT coalesce(max(substring(r.numero from '[0-9]+$')::int), 0) + 1
      INTO v_sequencia
      FROM recebimento r
     WHERE r.empresa_id = p_empresa_id
       AND r.numero LIKE v_prefixo || '%';

    RETURN v_prefixo || lpad(v_sequencia::text, 6, '0');
END;
$$;

COMMENT ON FUNCTION fn_proximo_numero_recebimento(uuid) IS
    'RF-039 - proximo numero de recebimento da empresa no ano corrente.';

-- -----------------------------------------------------------------------------
-- 4. RF-037: o pedido e a soma dos seus itens
--
-- Tres numeros, tres significados -- e nenhum deles informado pelo cliente:
--   item.valor_total          quantidade * preco - desconto do item;
--   item.valor_frete_rateado  parcela do item nas despesas do pedido;
--   pedido.valor_produtos     soma dos itens, ja liquida dos descontos de item;
--   pedido.valor_total        valor_produtos - desconto + frete + seguro +
--                             outras despesas.
--
-- O rateio existe para que a entrada no estoque seja valorizada pelo custo posto
-- (RF-034): frete que fica so no cabecalho vira lucro aparente na primeira
-- saida. Por construcao, sum(valor_total + valor_frete_rateado) = valor_total do
-- pedido -- o resto da divisao vai para o ultimo item, como o resto do
-- parcelamento vai para a ultima parcela (09).
-- -----------------------------------------------------------------------------

-- 4.1 BEFORE do item: valida a janela de edicao e calcula o total da linha.
CREATE OR REPLACE FUNCTION fn_prepara_pedido_compra_item() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_pedido_id uuid;
    v_pedido    record;
    v_produto   record;
    v_bruto     dom_valor;
BEGIN
    -- `NEW` nao existe no DELETE: a linha a conferir e sempre a que ha.
    v_pedido_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.pedido_compra_id
                        ELSE NEW.pedido_compra_id END;

    SELECT p.numero, p.status INTO v_pedido
      FROM pedido_compra p
     WHERE p.id = v_pedido_id;

    IF NOT FOUND THEN
        -- O pedido pode ter sido removido na mesma transacao (os itens caem por
        -- CASCADE): nao ha janela de edicao a conferir. Fora do DELETE, a FK ja
        -- teria recusado a linha.
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RAISE EXCEPTION 'Pedido de compra % nao encontrado nesta empresa.', v_pedido_id;
    END IF;

    -- Projecoes escritas pelos triggers das secoes 4.2 e 6.3 (`quantidade_recebida`
    -- e `valor_frete_rateado`): passam sempre, inclusive num pedido ja aprovado.
    -- Sao exatamente as colunas que a aplicacao nao informa.
    IF TG_OP = 'UPDATE' THEN
        IF (NEW.empresa_id, NEW.pedido_compra_id, NEW.sequencia, NEW.produto_id, NEW.descricao,
            NEW.quantidade, NEW.preco_unitario, NEW.valor_desconto, NEW.valor_total,
            NEW.centro_custo_id, NEW.local_estoque_id, NEW.observacao)
           IS NOT DISTINCT FROM
           (OLD.empresa_id, OLD.pedido_compra_id, OLD.sequencia, OLD.produto_id, OLD.descricao,
            OLD.quantidade, OLD.preco_unitario, OLD.valor_desconto, OLD.valor_total,
            OLD.centro_custo_id, OLD.local_estoque_id, OLD.observacao) THEN
            RETURN NEW;
        END IF;
    END IF;

    -- RF-038: aprovar um pedido cujos itens ainda podem mudar nao e aprovar
    -- nada. Depois do rascunho, corrigir e emitir outro pedido.
    IF v_pedido.status <> 'RASCUNHO' THEN
        RAISE EXCEPTION 'O pedido % esta % e seus itens nao podem mais ser alterados (RF-038).',
            v_pedido.numero, v_pedido.status;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;

    IF NEW.produto_id IS NOT NULL THEN
        SELECT pr.codigo, pr.ativo INTO v_produto FROM produto pr WHERE pr.id = NEW.produto_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Produto % nao encontrado nesta empresa.', NEW.produto_id;
        END IF;
        IF NOT v_produto.ativo THEN
            RAISE EXCEPTION 'O item % esta inativo e nao pode ser comprado.', v_produto.codigo;
        END IF;
    END IF;

    v_bruto := round(NEW.quantidade * NEW.preco_unitario, 2);
    IF NEW.valor_desconto > v_bruto THEN
        RAISE EXCEPTION 'O desconto (%) do item % supera o valor da linha (%) (RF-037).',
            NEW.valor_desconto, NEW.sequencia, v_bruto;
    END IF;

    NEW.valor_total := v_bruto - NEW.valor_desconto;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_prepara_pedido_compra_item() IS
    'RF-037/RF-038 - calcula o total da linha e congela os itens fora do rascunho.';

DROP TRIGGER IF EXISTS trg_prepara_pedido_compra_item ON pedido_compra_item;
CREATE TRIGGER trg_prepara_pedido_compra_item
    BEFORE INSERT OR UPDATE OR DELETE ON pedido_compra_item
    FOR EACH ROW EXECUTE FUNCTION fn_prepara_pedido_compra_item();

-- 4.2 Totais do pedido e rateio das despesas, num lugar so.
--
-- SECURITY DEFINER porque a aplicacao perde UPDATE sobre as colunas de total
-- (secao 9 revoga a escrita de `recebimento`; aqui o que protege o total e o
-- proprio calculo): a projecao passa a ser alcancavel somente por este caminho.
-- Continua sujeita a RLS -- gestao_owner tem FORCE ROW LEVEL SECURITY (03).
CREATE OR REPLACE FUNCTION fn_recalcula_pedido_compra(p_pedido_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = gestao, public AS $$
DECLARE
    v_pedido    record;
    v_produtos  dom_valor := 0;
    v_total     dom_valor;
    v_despesas  dom_valor;
    v_acumulado dom_valor := 0;
    v_ultimo    uuid;
    r           record;
BEGIN
    SELECT p.id, p.numero, p.valor_desconto, p.valor_frete, p.valor_seguro,
           p.valor_outras_despesas
      INTO v_pedido
      FROM pedido_compra p
     WHERE p.id = p_pedido_id;

    IF NOT FOUND THEN
        RETURN;   -- pedido removido na mesma transacao: nao ha o que projetar
    END IF;

    SELECT coalesce(sum(i.valor_total), 0) INTO v_produtos
      FROM pedido_compra_item i
     WHERE i.pedido_compra_id = p_pedido_id;

    v_despesas := v_pedido.valor_frete + v_pedido.valor_seguro
                + v_pedido.valor_outras_despesas - v_pedido.valor_desconto;
    v_total    := v_produtos + v_despesas;

    IF v_total < 0 THEN
        RAISE EXCEPTION 'O desconto do pedido % supera o valor dos itens e das despesas (RF-037).',
            v_pedido.numero;
    END IF;

    -- Rateio proporcional ao valor da linha. Sem itens (ou com itens que somam
    -- zero) nao ha base para ratear: as despesas ficam so no cabecalho.
    SELECT i.id INTO v_ultimo
      FROM pedido_compra_item i
     WHERE i.pedido_compra_id = p_pedido_id
     ORDER BY i.sequencia DESC
     LIMIT 1;

    FOR r IN
        SELECT i.id, i.valor_total
          FROM pedido_compra_item i
         WHERE i.pedido_compra_id = p_pedido_id
         ORDER BY i.sequencia
    LOOP
        DECLARE v_rateio dom_valor;
        BEGIN
            IF v_produtos = 0 OR v_despesas = 0 THEN
                v_rateio := 0;
            ELSIF r.id = v_ultimo THEN
                -- O resto da divisao vai para a ultima linha: sem isso, centavos
                -- evaporam e a soma dos itens deixa de bater com o pedido.
                v_rateio := v_despesas - v_acumulado;
            ELSE
                v_rateio := round(v_despesas * (r.valor_total / v_produtos), 2);
            END IF;

            v_acumulado := v_acumulado + v_rateio;

            UPDATE pedido_compra_item
               SET valor_frete_rateado = v_rateio
             WHERE id = r.id
               AND valor_frete_rateado IS DISTINCT FROM v_rateio;
        END;
    END LOOP;

    UPDATE pedido_compra
       SET valor_produtos = v_produtos,
           valor_total    = v_total
     WHERE id = p_pedido_id
       AND (valor_produtos IS DISTINCT FROM v_produtos OR valor_total IS DISTINCT FROM v_total);
END;
$$;

COMMENT ON FUNCTION fn_recalcula_pedido_compra(uuid) IS
    'RF-037 - projeta o total do pedido a partir dos itens e rateia frete, seguro e despesas.';

CREATE OR REPLACE FUNCTION fn_pedido_compra_item_projeta() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    -- As duas colunas projetadas (`valor_frete_rateado`, escrita pelo proprio
    -- recalculo, e `quantidade_recebida`, escrita pelo recebimento) nao entram
    -- no total. Sem esta saida antecipada, gravar o rateio dispararia um novo
    -- recalculo por item -- uma cascata de N niveis num pedido de N linhas, que
    -- termina no mesmo resultado depois de N vezes mais trabalho.
    IF TG_OP = 'UPDATE' THEN
        IF (NEW.quantidade, NEW.preco_unitario, NEW.valor_desconto, NEW.valor_total,
            NEW.pedido_compra_id)
           IS NOT DISTINCT FROM
           (OLD.quantidade, OLD.preco_unitario, OLD.valor_desconto, OLD.valor_total,
            OLD.pedido_compra_id) THEN
            RETURN NULL;
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        PERFORM fn_recalcula_pedido_compra(OLD.pedido_compra_id);
    ELSE
        PERFORM fn_recalcula_pedido_compra(NEW.pedido_compra_id);
    END IF;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_pedido_compra_item_projeta ON pedido_compra_item;
CREATE TRIGGER trg_pedido_compra_item_projeta
    AFTER INSERT OR UPDATE OR DELETE ON pedido_compra_item
    FOR EACH ROW EXECUTE FUNCTION fn_pedido_compra_item_projeta();

-- Alterar frete, seguro, outras despesas ou desconto do cabecalho refaz o
-- rateio. O gatilho e condicional a essas quatro colunas: sem isso, a propria
-- gravacao dos totais dispararia o recalculo de novo, em ciclo.
CREATE OR REPLACE FUNCTION fn_pedido_compra_despesas_projeta() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM fn_recalcula_pedido_compra(NEW.id);
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_pedido_compra_despesas ON pedido_compra;
CREATE TRIGGER trg_pedido_compra_despesas
    AFTER UPDATE OF valor_frete, valor_seguro, valor_outras_despesas, valor_desconto
    ON pedido_compra
    FOR EACH ROW EXECUTE FUNCTION fn_pedido_compra_despesas_projeta();

-- -----------------------------------------------------------------------------
-- 5. RF-036 / RF-038: maquina de estados e aprovacao do pedido
--
-- `status` anda para frente e para o lado, nunca para tras: recebido nao volta a
-- rascunho, reprovado nao volta a pendente. Rever exige um pedido novo -- e a
-- mesma escolha do titulo (09) e do inventario (08), pela mesma razao: uma
-- decisao registrada que pode ser desfeita em silencio nao e uma decisao.
--
-- O fornecedor e conferido aqui e nao so no service: pedido emitido contra quem
-- nunca foi fornecedor e erro de cadastro, nao de digitacao (RF-023/RF-041).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_valida_pedido_compra() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_permitido        text[];
    v_parceiro         record;
    v_recebidos        int;
    v_troca_fornecedor boolean;
BEGIN
    v_troca_fornecedor := TG_OP = 'INSERT';
    IF TG_OP = 'UPDATE' THEN
        v_troca_fornecedor := NEW.parceiro_id IS DISTINCT FROM OLD.parceiro_id;
    END IF;

    IF v_troca_fornecedor THEN
        SELECT p.razao_social, p.eh_fornecedor, p.ativo INTO v_parceiro
          FROM parceiro p WHERE p.id = NEW.parceiro_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Parceiro % nao encontrado nesta empresa.', NEW.parceiro_id;
        END IF;
        IF NOT v_parceiro.eh_fornecedor THEN
            RAISE EXCEPTION 'O parceiro % nao exerce o papel de fornecedor (RF-023).',
                v_parceiro.razao_social;
        END IF;
        IF NOT v_parceiro.ativo THEN
            RAISE EXCEPTION 'O fornecedor % esta inativo e nao aceita pedido.',
                v_parceiro.razao_social;
        END IF;
    END IF;

    IF TG_OP = 'INSERT' THEN
        RETURN NEW;
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
        v_permitido := CASE OLD.status
            WHEN 'RASCUNHO'               THEN ARRAY['AGUARDANDO_APROVACAO','APROVADO','CANCELADO']
            WHEN 'AGUARDANDO_APROVACAO'   THEN ARRAY['APROVADO','REPROVADO','CANCELADO']
            WHEN 'APROVADO'               THEN ARRAY['PARCIALMENTE_RECEBIDO','RECEBIDO','CANCELADO']
            WHEN 'PARCIALMENTE_RECEBIDO'  THEN ARRAY['RECEBIDO']
            WHEN 'REPROVADO'              THEN ARRAY['CANCELADO']
            ELSE ARRAY[]::text[]
        END;

        IF NOT (NEW.status::text = ANY (v_permitido)) THEN
            RAISE EXCEPTION 'O pedido % nao pode ir de % para % (RF-036).',
                OLD.numero, OLD.status, NEW.status;
        END IF;

        IF NEW.status = 'CANCELADO' THEN
            -- Cancelar um pedido ja recebido deixaria mercadoria no estoque sem
            -- documento que a explique. O caminho e encerrar o que resta, nao
            -- apagar o que chegou (RN-009).
            SELECT count(*) INTO v_recebidos
              FROM recebimento r WHERE r.pedido_compra_id = NEW.id;
            IF v_recebidos > 0 THEN
                RAISE EXCEPTION 'O pedido % tem % recebimento(s) e nao pode ser cancelado (RF-039).',
                    OLD.numero, v_recebidos;
            END IF;
            NEW.cancelado_em := coalesce(NEW.cancelado_em, now());
        END IF;
    END IF;

    IF NEW.status_aprovacao IS DISTINCT FROM OLD.status_aprovacao THEN
        v_permitido := CASE OLD.status_aprovacao
            WHEN 'NAO_REQUERIDA' THEN ARRAY['PENDENTE','APROVADO','CANCELADO']
            WHEN 'PENDENTE'      THEN ARRAY['APROVADO','REPROVADO','CANCELADO']
            ELSE ARRAY[]::text[]
        END;

        IF NOT (NEW.status_aprovacao::text = ANY (v_permitido)) THEN
            RAISE EXCEPTION 'A aprovacao do pedido % nao pode ir de % para % (RF-038).',
                OLD.numero, OLD.status_aprovacao, NEW.status_aprovacao;
        END IF;

        IF NEW.status_aprovacao IN ('APROVADO','REPROVADO') THEN
            NEW.aprovado_em := coalesce(NEW.aprovado_em, now());
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_valida_pedido_compra() IS
    'RF-036/RF-038 - transicoes validas do pedido e da aprovacao, e papel do fornecedor.';

DROP TRIGGER IF EXISTS trg_valida_pedido_compra ON pedido_compra;
CREATE TRIGGER trg_valida_pedido_compra
    BEFORE INSERT OR UPDATE ON pedido_compra
    FOR EACH ROW EXECUTE FUNCTION fn_valida_pedido_compra();

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.pedido_compra'::regclass
                      AND conname = 'ck_pedido_compra_cancelamento') THEN
        ALTER TABLE pedido_compra ADD CONSTRAINT ck_pedido_compra_cancelamento
            CHECK (status <> 'CANCELADO' OR motivo_cancelamento IS NOT NULL);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.pedido_compra'::regclass
                      AND conname = 'ck_pedido_compra_despesas') THEN
        ALTER TABLE pedido_compra ADD CONSTRAINT ck_pedido_compra_despesas
            CHECK (valor_frete >= 0 AND valor_seguro >= 0 AND valor_outras_despesas >= 0);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.pedido_compra_item'::regclass
                      AND conname = 'ck_pedido_item_preco') THEN
        ALTER TABLE pedido_compra_item ADD CONSTRAINT ck_pedido_item_preco
            CHECK (preco_unitario >= 0 AND valor_desconto >= 0 AND valor_total >= 0);
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 6. RF-039 / RF-040: o recebimento e append-only, e o pedido e projecao dele
--
-- 6.1 Validacao e conferencia da linha recebida.
--
-- O advisory lock por item do pedido serializa quem recebe a mesma linha: sem
-- ele, dois recebimentos simultaneos leem a mesma quantidade pendente e ambos
-- passam pela verificacao de excesso -- o pedido termina recebido em dobro, e a
-- mercadoria ja entrou no estoque.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_prepara_recebimento_item() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_item      record;
    v_pedido    record;
    v_receb     record;
    v_pendente  dom_quantidade;
    v_preco     dom_valor_unit;
BEGIN
    SELECT r.numero, r.pedido_compra_id INTO v_receb
      FROM recebimento r WHERE r.id = NEW.recebimento_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Recebimento % nao encontrado nesta empresa.', NEW.recebimento_id;
    END IF;

    -- Recebimento sem pedido (entrega avulsa) e do M07, e nao tem pedido a
    -- conferir: a linha entra como esta, sem projecao para tras.
    IF NEW.pedido_compra_item_id IS NULL THEN
        IF v_receb.pedido_compra_id IS NOT NULL THEN
            RAISE EXCEPTION 'O recebimento % e de um pedido: informe o item do pedido conferido (RF-040).',
                v_receb.numero;
        END IF;
        NEW.tipo_divergencia := 'NENHUMA';
        RETURN NEW;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('pedido_compra_item:' || NEW.pedido_compra_item_id::text));

    SELECT i.id, i.pedido_compra_id, i.sequencia, i.produto_id, i.quantidade,
           i.quantidade_recebida, i.preco_unitario
      INTO v_item
      FROM pedido_compra_item i
     WHERE i.id = NEW.pedido_compra_item_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Item de pedido % nao encontrado nesta empresa.', NEW.pedido_compra_item_id;
    END IF;
    IF v_item.pedido_compra_id IS DISTINCT FROM v_receb.pedido_compra_id THEN
        RAISE EXCEPTION 'O item conferido nao pertence ao pedido do recebimento % (RF-040).',
            v_receb.numero;
    END IF;

    SELECT p.numero, p.status INTO v_pedido
      FROM pedido_compra p WHERE p.id = v_item.pedido_compra_id;

    -- RF-038: o controle de aprovacao so tem efeito se barrar a entrega. Um
    -- pedido que espera decisao e um pedido que ainda nao foi feito.
    IF v_pedido.status NOT IN ('APROVADO','PARCIALMENTE_RECEBIDO') THEN
        RAISE EXCEPTION 'O pedido % esta % e nao aceita recebimento (RF-038/RF-039).',
            v_pedido.numero, v_pedido.status;
    END IF;

    IF NEW.quantidade_recebida <= 0 THEN
        RAISE EXCEPTION 'A quantidade recebida do item % deve ser maior que zero (RF-039).',
            v_item.sequencia;
    END IF;

    -- Linha recusada na conferencia nao entra no pedido nem no estoque, mas fica
    -- registrada: e o que distingue "nao chegou" de "chegou e foi devolvido".
    IF NEW.aceito THEN
        v_pendente := v_item.quantidade - v_item.quantidade_recebida;
        IF NEW.quantidade_recebida > v_pendente THEN
            RAISE EXCEPTION 'Recebimento de % excede o saldo % do item % do pedido % (RF-039).',
                NEW.quantidade_recebida, v_pendente, v_item.sequencia, v_pedido.numero;
        END IF;
    END IF;

    NEW.produto_id        := coalesce(NEW.produto_id, v_item.produto_id);
    NEW.quantidade_pedida := v_item.quantidade;
    NEW.preco_pedido      := v_item.preco_unitario;

    -- RF-040: a divergencia e apurada aqui, uma vez, contra o que foi pedido.
    -- Calculada no cliente, ela viraria opiniao de quem digita a conferencia.
    v_preco := coalesce(NEW.preco_documento, v_item.preco_unitario);
    NEW.tipo_divergencia := CASE
        WHEN NEW.quantidade_recebida <> v_item.quantidade AND v_preco <> v_item.preco_unitario THEN 'AMBOS'
        WHEN NEW.quantidade_recebida <> v_item.quantidade THEN 'QUANTIDADE'
        WHEN v_preco <> v_item.preco_unitario THEN 'PRECO'
        ELSE 'NENHUMA'
    END;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_prepara_recebimento_item() IS
    'RF-039/RF-040 - serializa o item do pedido, recusa recebimento acima do saldo e apura a divergencia.';

DROP TRIGGER IF EXISTS trg_prepara_recebimento_item ON recebimento_item;
CREATE TRIGGER trg_prepara_recebimento_item
    BEFORE INSERT ON recebimento_item
    FOR EACH ROW EXECUTE FUNCTION fn_prepara_recebimento_item();

-- 6.2 Append-only, sem excecao.
--
-- Como o razao de estoque (08), a baixa (09) e a trilha (05): conferencia
-- registrada nao se edita nem se apaga. Corrigir e registrar outro recebimento
-- -- e, se a mercadoria voltou, uma devolucao (M07, Sprint 9).
CREATE OR REPLACE FUNCTION fn_bloqueia_alteracao_recebimento() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Recebimento nao pode ser removido (RF-039). Registre a correcao.';
    END IF;
    RAISE EXCEPTION 'Recebimento nao pode ser alterado (RF-039). Registre a correcao.';
END;
$$;

DROP TRIGGER IF EXISTS trg_recebimento_item_imutavel ON recebimento_item;
CREATE TRIGGER trg_recebimento_item_imutavel
    BEFORE UPDATE OR DELETE ON recebimento_item
    FOR EACH ROW EXECUTE FUNCTION fn_bloqueia_alteracao_recebimento();

-- O cabecalho aceita uma unica classe de alteracao: as tres marcas projetadas
-- pelas secoes 6.3 e 7. Tudo o mais -- data, local, conferente, pedido -- e o
-- que foi no dia da entrega.
CREATE OR REPLACE FUNCTION fn_bloqueia_alteracao_recebimento_cab() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Recebimento nao pode ser removido (RF-039). Registre a correcao.';
    END IF;

    IF (NEW.empresa_id, NEW.filial_id, NEW.pedido_compra_id, NEW.documento_fiscal_id, NEW.numero,
        NEW.data_recebimento, NEW.local_estoque_id, NEW.conferente_id, NEW.observacao, NEW.criado_em)
       IS DISTINCT FROM
       (OLD.empresa_id, OLD.filial_id, OLD.pedido_compra_id, OLD.documento_fiscal_id, OLD.numero,
        OLD.data_recebimento, OLD.local_estoque_id, OLD.conferente_id, OLD.observacao, OLD.criado_em) THEN
        RAISE EXCEPTION 'O recebimento % so aceita a atualizacao das marcas de divergencia, estoque e financeiro (RF-039).',
            OLD.numero;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_recebimento_imutavel ON recebimento;
CREATE TRIGGER trg_recebimento_imutavel
    BEFORE UPDATE OR DELETE ON recebimento
    FOR EACH ROW EXECUTE FUNCTION fn_bloqueia_alteracao_recebimento_cab();

-- 6.3 Projecao: item do pedido a partir das linhas aceitas, pedido a partir dos
-- itens, e a marca de divergencia no cabecalho do recebimento.
--
-- SECURITY DEFINER pela mesma razao do estoque e da baixa: a aplicacao perde
-- UPDATE sobre `recebimento` (secao 9), e esta e a unica escrita que resta.
CREATE OR REPLACE FUNCTION fn_aplica_recebimento_item() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = gestao, public AS $$
DECLARE
    v_pedido uuid;
    v_preco  dom_valor_unit;
BEGIN
    UPDATE recebimento r
       SET possui_divergencia = EXISTS (SELECT 1 FROM recebimento_item i
                                         WHERE i.recebimento_id = r.id
                                           AND i.tipo_divergencia IS DISTINCT FROM 'NENHUMA')
     WHERE r.id = NEW.recebimento_id;

    -- RF-042: o custo da ultima compra do item vem daqui -- da mercadoria que
    -- chegou, pelo preco do documento, e nao do pedido que ainda podia mudar.
    IF NEW.produto_id IS NOT NULL AND NEW.aceito THEN
        v_preco := coalesce(NEW.preco_documento, NEW.preco_pedido);
        IF v_preco IS NOT NULL AND v_preco > 0 THEN
            UPDATE produto
               SET custo_ultima_compra = v_preco,
                   data_ultima_compra  = current_date
             WHERE id = NEW.produto_id;
        END IF;
    END IF;

    IF NEW.pedido_compra_item_id IS NULL THEN
        RETURN NULL;
    END IF;

    UPDATE pedido_compra_item i
       SET quantidade_recebida = sub.recebida
      FROM (SELECT coalesce(sum(ri.quantidade_recebida), 0) AS recebida
              FROM recebimento_item ri
             WHERE ri.pedido_compra_item_id = NEW.pedido_compra_item_id
               AND ri.aceito) sub
     WHERE i.id = NEW.pedido_compra_item_id
    RETURNING i.pedido_compra_id INTO v_pedido;

    -- O pedido e o retrato dos seus itens: totalmente atendido quando nenhum
    -- item tem saldo, parcialmente enquanto houver o que chegar.
    UPDATE pedido_compra p
       SET status = CASE
                        WHEN sub.pendentes = 0 THEN 'RECEBIDO'::enum_status_pedido_compra
                        ELSE 'PARCIALMENTE_RECEBIDO'::enum_status_pedido_compra
                    END
      FROM (SELECT count(*) FILTER (WHERE i.quantidade_recebida < i.quantidade) AS pendentes
              FROM pedido_compra_item i
             WHERE i.pedido_compra_id = v_pedido) sub
     WHERE p.id = v_pedido
       AND p.status IN ('APROVADO','PARCIALMENTE_RECEBIDO');

    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION fn_aplica_recebimento_item() IS
    'RF-039/RF-042 - projeta o recebido no item, o status no pedido e o custo da ultima compra no produto.';

DROP TRIGGER IF EXISTS trg_aplica_recebimento_item ON recebimento_item;
CREATE TRIGGER trg_aplica_recebimento_item
    AFTER INSERT ON recebimento_item
    FOR EACH ROW EXECUTE FUNCTION fn_aplica_recebimento_item();

-- -----------------------------------------------------------------------------
-- 7. RF-041: vinculo com estoque e financeiro, sem duplicidade
--
-- RN-004: uma entrega gera uma entrada de estoque e um titulo -- uma vez. Os
-- indices parciais abaixo sao o que impede a segunda tentativa de virar
-- mercadoria a mais no deposito e dinheiro a mais saindo; a marca no cabecalho
-- e projecao do que existe, e nao um campo que a aplicacao promete manter.
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS ux_movimento_origem_recebimento
    ON movimento_estoque (origem_id) WHERE origem_tipo = 'RECEBIMENTO';

CREATE UNIQUE INDEX IF NOT EXISTS ux_titulo_origem_recebimento
    ON titulo (empresa_id, origem_id) WHERE origem_tipo = 'RECEBIMENTO';

CREATE OR REPLACE FUNCTION fn_marca_recebimento_estoque() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = gestao, public AS $$
BEGIN
    UPDATE recebimento r
       SET gerou_estoque = true
      FROM recebimento_item i
     WHERE i.id = NEW.origem_id
       AND r.id = i.recebimento_id
       AND NOT r.gerou_estoque;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_marca_recebimento_estoque ON movimento_estoque;
CREATE TRIGGER trg_marca_recebimento_estoque
    AFTER INSERT ON movimento_estoque
    FOR EACH ROW WHEN (NEW.origem_tipo = 'RECEBIMENTO' AND NEW.origem_id IS NOT NULL)
    EXECUTE FUNCTION fn_marca_recebimento_estoque();

CREATE OR REPLACE FUNCTION fn_marca_recebimento_financeiro() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = gestao, public AS $$
BEGIN
    UPDATE recebimento
       SET gerou_financeiro = true
     WHERE id = NEW.origem_id
       AND NOT gerou_financeiro;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_marca_recebimento_financeiro ON titulo;
CREATE TRIGGER trg_marca_recebimento_financeiro
    AFTER INSERT ON titulo
    FOR EACH ROW WHEN (NEW.origem_tipo = 'RECEBIMENTO' AND NEW.origem_id IS NOT NULL)
    EXECUTE FUNCTION fn_marca_recebimento_financeiro();

-- -----------------------------------------------------------------------------
-- 8. RF-042: historico de compras e de precos
--
-- Vive no modelo, como a posicao da carteira (09) e o alerta de estoque minimo
-- (01): "quanto paguei da ultima vez, e a quem" e a pergunta que decide a
-- proxima compra, e ela nao pode depender de quem escreveu o relatorio.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_historico_compra AS
SELECT i.empresa_id,
       i.id                       AS pedido_compra_item_id,
       p.id                       AS pedido_compra_id,
       p.numero,
       p.data_pedido,
       p.status,
       p.status_aprovacao,
       p.parceiro_id,
       p.filial_id,
       i.sequencia,
       i.produto_id,
       i.descricao,
       i.quantidade,
       i.quantidade_recebida,
       greatest(i.quantidade - i.quantidade_recebida, 0)          AS quantidade_pendente,
       i.preco_unitario,
       i.valor_desconto,
       i.valor_total,
       i.valor_frete_rateado,
       -- Custo posto: o preco que o item efetivamente custou, com a parcela dele
       -- no frete e nas despesas. E o numero que se compara entre fornecedores.
       CASE WHEN i.quantidade > 0
            THEN round((i.valor_total + i.valor_frete_rateado) / i.quantidade, 6)
       END                                                        AS custo_unitario_posto
  FROM pedido_compra_item i
  JOIN pedido_compra p ON p.id = i.pedido_compra_id
 WHERE p.status NOT IN ('CANCELADO', 'REPROVADO');

COMMENT ON VIEW vw_historico_compra IS
    'RF-042 - itens comprados com preco negociado, custo posto e quanto ainda falta receber.';

-- -----------------------------------------------------------------------------
-- 9. Privilegios: o recebimento e a unica porta de entrada da conferencia
--
-- Retirar UPDATE e DELETE de `recebimento` e `recebimento_item` da role da
-- aplicacao e a segunda barreira do append-only: um trigger pode ser
-- desabilitado por quem tem direito sobre a tabela; um GRANT ausente, nao. As
-- marcas de divergencia, estoque e financeiro continuam sendo escritas porque
-- quem as escreve sao os triggers SECURITY DEFINER das secoes 6.3 e 7.
-- -----------------------------------------------------------------------------
DO $$
DECLARE r text;
BEGIN
    FOREACH r IN ARRAY ARRAY['app_gestao', 'sge_api'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON gestao.recebimento FROM %I;', r);
            EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON gestao.recebimento_item FROM %I;', r);
            EXECUTE format('GRANT SELECT, INSERT ON gestao.recebimento TO %I;', r);
            EXECUTE format('GRANT SELECT, INSERT ON gestao.recebimento_item TO %I;', r);

            EXECUTE format(
                'GRANT EXECUTE ON FUNCTION gestao.fn_proximo_numero_pedido_compra(uuid) TO %I;', r);
            EXECUTE format(
                'GRANT EXECUTE ON FUNCTION gestao.fn_proximo_numero_recebimento(uuid) TO %I;', r);
            EXECUTE format('GRANT SELECT ON gestao.vw_historico_compra TO %I;', r);
        END IF;
    END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 10. Indices de consulta
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS ix_pedido_compra_aprovacao
    ON pedido_compra (empresa_id, status_aprovacao) WHERE status_aprovacao = 'PENDENTE';

CREATE INDEX IF NOT EXISTS ix_pedido_compra_item_produto
    ON pedido_compra_item (produto_id, empresa_id) WHERE produto_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_recebimento_item_pedido_item
    ON recebimento_item (pedido_compra_item_id) WHERE pedido_compra_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_recebimento_empresa_data
    ON recebimento (empresa_id, data_recebimento DESC);

-- -----------------------------------------------------------------------------
-- 11. Reaplica o search_path fixo exigido por 04 nas funcoes criadas aqui.
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
-- 12. Verificacao
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
       AND tgname IN ('trg_prepara_pedido_compra_item','trg_pedido_compra_item_projeta',
                      'trg_pedido_compra_despesas','trg_valida_pedido_compra',
                      'trg_prepara_recebimento_item','trg_aplica_recebimento_item',
                      'trg_recebimento_item_imutavel','trg_recebimento_imutavel',
                      'trg_marca_recebimento_estoque','trg_marca_recebimento_financeiro',
                      'trg_pedido_compra_item_auditoria','trg_recebimento_item_auditoria');
    IF v_triggers < 12 THEN
        RAISE WARNING 'regras do M06 incompletas (% de 12)', v_triggers; v_falhas := v_falhas + 1;
    END IF;

    SELECT count(*) INTO v_fks
      FROM pg_constraint
     WHERE contype = 'f'
       AND conname LIKE 'fk\_%\_tenant'
       AND conrelid IN ('gestao.pedido_compra'::regclass, 'gestao.pedido_compra_item'::regclass,
                        'gestao.recebimento'::regclass, 'gestao.recebimento_item'::regclass);
    IF v_fks < 17 THEN
        RAISE WARNING 'FKs multiempresa do M06 incompletas (% de 17)', v_fks; v_falhas := v_falhas + 1;
    END IF;

    SELECT count(*) INTO v_indices
      FROM pg_indexes
     WHERE schemaname = 'gestao'
       AND indexname IN ('ux_movimento_origem_recebimento','ux_titulo_origem_recebimento');
    IF v_indices < 2 THEN
        RAISE WARNING 'protecao contra duplicidade ausente (% de 2) - RN-004', v_indices;
        v_falhas := v_falhas + 1;
    END IF;

    SELECT count(*) INTO v_gravavel
      FROM information_schema.table_privileges
     WHERE table_schema = 'gestao'
       AND table_name IN ('recebimento','recebimento_item')
       AND grantee IN ('app_gestao','sge_api')
       AND privilege_type IN ('UPDATE','DELETE');
    IF v_gravavel > 0 THEN
        RAISE WARNING 'recebimento ainda alteravel pela aplicacao (% privilegios)', v_gravavel;
        v_falhas := v_falhas + 1;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_views
                    WHERE schemaname = 'gestao' AND viewname = 'vw_historico_compra') THEN
        RAISE WARNING 'historico de compras ausente (RF-042)'; v_falhas := v_falhas + 1;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_proc
                    WHERE pronamespace = 'gestao'::regnamespace
                      AND proname = 'fn_proximo_numero_pedido_compra') THEN
        RAISE WARNING 'numeracao do pedido ausente (RF-036)'; v_falhas := v_falhas + 1;
    END IF;

    IF v_falhas = 0 THEN
        RAISE NOTICE 'M06 - Compras: ajustes aplicados com sucesso.';
    END IF;
END $$;
