-- =============================================================================
-- 09_financeiro_sprint6.sql
-- Sprint 6 - Fase 3 (Financeiro): M08 - Contas a Pagar e Receber (RF-051 a RF-058).
--
-- Executar como gestao_owner, depois de 01 a 08:
--   psql -U gestao_owner -h localhost -d gestao_empresarial -f 09_financeiro_sprint6.sql
-- Idempotente: pode ser reexecutado.
--
-- O que 02/03 ja entregavam: as tabelas (recorrencia, titulo, titulo_parcela,
-- titulo_baixa), a RLS por empresa, a auditoria do titulo e das baixas e um
-- trigger que recalculava saldos apos a baixa. Este script fecha o que faltava
-- para o contas a pagar/receber ser confiavel:
--   1. RN-010 - trilha de auditoria tambem na recorrencia
--   2. RN-001 - referencias presas a mesma empresa (FK composta)
--   3. RF-051/RF-052 - numeracao sequencial por empresa, tipo e ano
--   4. RF-053 - o titulo e a soma das suas parcelas, verificado no commit
--   5. RF-055 - vencimento original preservado e encargos calculados no modelo
--   6. RF-056 - maquina de estados da aprovacao; titulo pendente nao e baixado
--   7. RF-057 - a baixa e append-only: estorno e lancamento contrario, e o
--                saldo do titulo passa a ser derivado das parcelas
--   8. RF-058 - posicao da carteira e inadimplencia como visao do modelo
--
-- Decisao estrutural: o saldo do titulo deixa de ser um numero que a aplicacao
-- escreve e passa a ser projecao das parcelas, que por sua vez sao projecao das
-- baixas. E a mesma escolha do razao de estoque (08): existe uma unica porta de
-- entrada -- o INSERT em `titulo_baixa` -- e tudo o que se ve depois dela e
-- consequencia calculada. Sem isso, "quanto ainda devo" vira um campo editavel,
-- e o primeiro estorno mal feito o separa da realidade sem deixar rastro.
-- =============================================================================
SET search_path = gestao, public;

-- -----------------------------------------------------------------------------
-- 1. RN-010: auditoria da recorrencia
--
-- `titulo`, `titulo_parcela` e `titulo_baixa` ja sao auditados desde 03. Falta a
-- recorrencia: e ela que decide quanto e quando um titulo futuro vai nascer, e
-- alterar o valor padrao de um contrato mensal precisa deixar rastro tanto
-- quanto alterar o titulo que ele gera.
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_recorrencia_auditoria ON recorrencia;
CREATE TRIGGER trg_recorrencia_auditoria
    AFTER INSERT OR UPDATE OR DELETE ON recorrencia
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria_generica();

-- -----------------------------------------------------------------------------
-- 2. RN-001: referencia cruzada entre empresas
--
-- Mesma tecnica de 06, 07 e 08: chave candidata (empresa_id, id) no destino e FK
-- composta (empresa_id, <coluna>) na origem. A verificacao de FK roda no
-- sistema, sem RLS -- sem a coluna de empresa na chave, um titulo da empresa A
-- poderia ser classificado no centro de custo da empresa B, ou pior, ser emitido
-- contra o parceiro dela.
--
-- `documento_fiscal_id` e `pedido_compra_id` ficam de fora: sao das Sprints 8 e
-- 9 e permanecem nulos ate la. Entram junto com os modulos que os preenchem, com
-- as chaves candidatas das respectivas tabelas.
-- -----------------------------------------------------------------------------
-- 2.1 Chave candidata (empresa_id, id) nas tabelas referenciadas aqui.
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'titulo','titulo_parcela','recorrencia','parceiro','funcionario',
        'categoria_financeira','centro_custo','forma_pagamento','condicao_pagamento'
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
-- Como em 06/07/08, o que era `ON DELETE SET NULL` vira `RESTRICT`: o PostgreSQL
-- 14 nao aceita SET NULL em FK composta. Na pratica isso e o comportamento
-- correto aqui -- categoria e centro de custo em uso viram cadastro inativo, nao
-- removido, e um titulo nao deve perder sua classificacao contabil em silencio.
DO $$
DECLARE
    r record;
    c record;
BEGIN
    FOR r IN
        SELECT * FROM (VALUES
            ('titulo',        'filial_id',               'filial',               'RESTRICT'),
            ('titulo',        'parceiro_id',             'parceiro',             'RESTRICT'),
            ('titulo',        'funcionario_id',          'funcionario',          'RESTRICT'),
            ('titulo',        'categoria_financeira_id', 'categoria_financeira', 'RESTRICT'),
            ('titulo',        'centro_custo_id',         'centro_custo',         'RESTRICT'),
            ('titulo',        'forma_pagamento_id',      'forma_pagamento',      'RESTRICT'),
            ('titulo',        'condicao_pagamento_id',   'condicao_pagamento',   'RESTRICT'),
            ('titulo',        'recorrencia_id',          'recorrencia',          'RESTRICT'),
            ('titulo_parcela','titulo_id',               'titulo',               'CASCADE'),
            ('titulo_baixa',  'titulo_parcela_id',       'titulo_parcela',       'RESTRICT'),
            ('titulo_baixa',  'forma_pagamento_id',      'forma_pagamento',      'RESTRICT'),
            ('recorrencia',   'parceiro_id',             'parceiro',             'RESTRICT'),
            ('recorrencia',   'categoria_financeira_id', 'categoria_financeira', 'RESTRICT'),
            ('recorrencia',   'centro_custo_id',         'centro_custo',         'RESTRICT')
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
-- 3. RF-051 / RF-052: numeracao do titulo
--
-- Sequencial por empresa, tipo e ano (mesma tecnica do reembolso em 06 e do
-- inventario em 08). O prefixo distingue as duas carteiras a olho nu: CP para
-- contas a pagar, CR para contas a receber. `uq_titulo_numero` ja garante a
-- unicidade por (empresa, tipo, numero); o advisory lock evita que dois pedidos
-- simultaneos leiam o mesmo maximo e disputem o mesmo numero.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_proximo_numero_titulo(p_empresa_id uuid, p_tipo enum_tipo_titulo)
RETURNS varchar
LANGUAGE plpgsql AS $$
DECLARE
    v_ano       text := to_char(current_date, 'YYYY');
    v_prefixo   text := CASE p_tipo WHEN 'PAGAR' THEN 'CP-' ELSE 'CR-' END || v_ano || '-';
    v_sequencia int;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('titulo:' || p_empresa_id::text || ':' || p_tipo::text));

    SELECT coalesce(max(substring(t.numero from '[0-9]+$')::int), 0) + 1
      INTO v_sequencia
      FROM titulo t
     WHERE t.empresa_id = p_empresa_id
       AND t.tipo = p_tipo
       AND t.numero LIKE v_prefixo || '%';

    RETURN v_prefixo || lpad(v_sequencia::text, 6, '0');
END;
$$;

COMMENT ON FUNCTION fn_proximo_numero_titulo(uuid, enum_tipo_titulo) IS
    'RF-051/RF-052 - proximo numero da carteira (CP/CR) da empresa no ano corrente.';

-- -----------------------------------------------------------------------------
-- 4. RF-053 / RF-054: o titulo e a soma das suas parcelas
--
-- 4.1 Valor liquido e derivado, nao informado.
--
-- `valor_liquido` chegava do cliente e podia divergir de `valor_bruto -
-- valor_desconto`. Dois numeros para o mesmo fato: o que a nota diz e o que o
-- financeiro cobra. Aqui o segundo passa a ser calculado a partir do primeiro.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_prepara_titulo() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.valor_liquido := NEW.valor_bruto - NEW.valor_desconto;

    IF NEW.valor_liquido < 0 THEN
        RAISE EXCEPTION 'O desconto (%) nao pode superar o valor bruto (%) do titulo % (RF-051).',
            NEW.valor_desconto, NEW.valor_bruto, NEW.numero;
    END IF;

    IF TG_OP = 'INSERT' THEN
        NEW.valor_liquidado := 0;
        NEW.saldo           := NEW.valor_liquido;
        RETURN NEW;
    END IF;

    -- Cancelar exige que nada tenha sido pago: um titulo com baixa viva
    -- cancelado deixaria o dinheiro que ja saiu sem documento que o explique. O
    -- caminho e estornar a baixa e so entao cancelar.
    IF NEW.status = 'CANCELADO' AND OLD.status <> 'CANCELADO' THEN
        IF EXISTS (SELECT 1
                     FROM titulo_baixa b
                     JOIN titulo_parcela p ON p.id = b.titulo_parcela_id
                    WHERE p.titulo_id = NEW.id
                      AND NOT b.estornada
                      AND b.estorno_de_id IS NULL) THEN
            RAISE EXCEPTION 'O titulo % tem baixa nao estornada e nao pode ser cancelado (RF-057).',
                NEW.numero;
        END IF;
        NEW.cancelado_em := coalesce(NEW.cancelado_em, now());
        -- Titulo cancelado nao deve mais nada. O saldo so seria recalculado na
        -- proxima baixa -- que nunca vem -- e ate la ele continuaria somando na
        -- exposicao do parceiro (RF-025) e em qualquer total da carteira.
        NEW.saldo := 0;
    END IF;

    IF NEW.valor_liquido IS DISTINCT FROM OLD.valor_liquido THEN
        NEW.saldo := greatest(NEW.valor_liquido - NEW.valor_liquidado, 0);
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_prepara_titulo() IS
    'RF-051/RF-054 - deriva o valor liquido e protege o cancelamento de titulo com baixa viva.';

DROP TRIGGER IF EXISTS trg_prepara_titulo ON titulo;
CREATE TRIGGER trg_prepara_titulo
    BEFORE INSERT OR UPDATE ON titulo
    FOR EACH ROW EXECUTE FUNCTION fn_prepara_titulo();

-- 4.2 As parcelas somam o titulo -- conferido no commit.
--
-- Constraint trigger DEFERRABLE INITIALLY DEFERRED, e nao um CHECK: o titulo e
-- suas parcelas nascem em INSERTs distintos, e a igualdade so pode ser exigida
-- quando a transacao inteira terminou. E a mesma tecnica das partidas dobradas
-- em 03 -- e pela mesma razao: a regra e sobre o conjunto, nao sobre a linha.
CREATE OR REPLACE FUNCTION fn_confere_parcelas_titulo(p_titulo_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
    v_titulo   record;
    v_soma     dom_valor;
    v_parcelas int;
BEGIN
    SELECT t.numero, t.status, t.valor_liquido
      INTO v_titulo
      FROM titulo t
     WHERE t.id = p_titulo_id;

    -- O titulo pode ter sido removido na mesma transacao (as parcelas caem por
    -- CASCADE): nao ha o que conferir. Cancelado e renegociado tambem saem --
    -- o primeiro nao e mais cobrado, e o segundo foi substituido por outro.
    IF NOT FOUND OR v_titulo.status IN ('CANCELADO', 'RENEGOCIADO') THEN
        RETURN;
    END IF;

    SELECT coalesce(sum(p.valor), 0), count(*)
      INTO v_soma, v_parcelas
      FROM titulo_parcela p
     WHERE p.titulo_id = p_titulo_id
       AND p.status <> 'CANCELADA';

    IF v_parcelas = 0 THEN
        RAISE EXCEPTION 'O titulo % precisa de ao menos uma parcela (RF-053).', v_titulo.numero;
    END IF;

    IF v_soma <> v_titulo.valor_liquido THEN
        RAISE EXCEPTION 'As parcelas do titulo % somam % e o valor liquido e % (RF-053).',
            v_titulo.numero, v_soma, v_titulo.valor_liquido;
    END IF;
END;
$$;

COMMENT ON FUNCTION fn_confere_parcelas_titulo(uuid) IS
    'RF-053 - as parcelas ativas somam exatamente o valor liquido do titulo.';

-- Duas funcoes de gatilho, e nao uma compartilhada: `NEW` tem tipos diferentes
-- em cada tabela, e uma funcao so precisaria descobrir em qual delas esta para
-- ler a coluna certa. A conferencia em si vive num lugar unico, acima.
CREATE OR REPLACE FUNCTION fn_titulo_confere_parcelas() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM fn_confere_parcelas_titulo(NEW.id);
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION fn_parcela_confere_titulo() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM fn_confere_parcelas_titulo(OLD.titulo_id);
        RETURN NULL;
    END IF;

    PERFORM fn_confere_parcelas_titulo(NEW.titulo_id);
    -- Mover a parcela de titulo deixa os dois desbalanceados: o de origem
    -- tambem precisa ser reconferido.
    IF TG_OP = 'UPDATE' AND OLD.titulo_id <> NEW.titulo_id THEN
        PERFORM fn_confere_parcelas_titulo(OLD.titulo_id);
    END IF;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_titulo_parcelas_somam ON titulo;
CREATE CONSTRAINT TRIGGER trg_titulo_parcelas_somam
    AFTER INSERT OR UPDATE ON titulo
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION fn_titulo_confere_parcelas();

DROP TRIGGER IF EXISTS trg_parcela_soma_titulo ON titulo_parcela;
CREATE CONSTRAINT TRIGGER trg_parcela_soma_titulo
    AFTER INSERT OR UPDATE OR DELETE ON titulo_parcela
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION fn_parcela_confere_titulo();

-- -----------------------------------------------------------------------------
-- 5. RF-055: vencimento, juros, multa e desconto
--
-- 5.1 O vencimento original e memoria, nao rascunho.
--
-- Prorrogar um vencimento e uma decisao comercial legitima; apagar a data
-- combinada no ato da compra nao. `data_vencimento_original` e gravada na
-- insercao e nunca mais muda -- e o que permite medir prazo medio concedido e
-- reconhecer o titulo que ja foi empurrado tres vezes.
--
-- Parcela liquidada nao muda de valor nem de vencimento: o fato ja aconteceu, e
-- a correcao e o estorno da baixa (RF-057).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_prepara_parcela() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.data_vencimento_original := coalesce(NEW.data_vencimento_original, NEW.data_vencimento);
        -- Liquidado e encargos sao projecao das baixas (secao 7.4): a parcela
        -- nasce devendo o principal inteiro, e nada mais.
        NEW.valor_liquidado := 0;
        NEW.valor_juros     := 0;
        NEW.valor_multa     := 0;
        NEW.valor_desconto  := 0;
        NEW.saldo           := NEW.valor;
        RETURN NEW;
    END IF;

    NEW.data_vencimento_original := OLD.data_vencimento_original;

    -- Mesma razao do titulo: parcela cancelada nao tem principal em aberto.
    IF NEW.status = 'CANCELADA' AND OLD.status <> 'CANCELADA' THEN
        NEW.saldo := 0;
    END IF;

    IF OLD.status IN ('LIQUIDADA', 'CANCELADA')
       AND (NEW.valor           IS DISTINCT FROM OLD.valor
         OR NEW.data_vencimento IS DISTINCT FROM OLD.data_vencimento) THEN
        RAISE EXCEPTION 'A parcela %/% esta % e nao aceita alteracao de valor ou vencimento (RF-055).',
            OLD.numero_parcela, OLD.total_parcelas, OLD.status;
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_prepara_parcela() IS
    'RF-055 - preserva o vencimento original e congela a parcela ja liquidada.';

DROP TRIGGER IF EXISTS trg_prepara_parcela ON titulo_parcela;
CREATE TRIGGER trg_prepara_parcela
    BEFORE INSERT OR UPDATE ON titulo_parcela
    FOR EACH ROW EXECUTE FUNCTION fn_prepara_parcela();

-- 5.2 O que cada coluna de valor da parcela quer dizer
--
-- Um numero, um significado -- sem isso a conta fecha por coincidencia:
--   valor            principal contratado da parcela (informado);
--   saldo            principal ainda em aberto = valor - somatorio das baixas;
--   valor_liquidado  caixa efetivamente movimentado = somatorio de valor_total;
--   valor_juros      encargos de mora cobrados nas baixas (projecao);
--   valor_multa      idem;
--   valor_desconto   abatimentos concedidos nas baixas (projecao).
--
-- Consequencia pratica: pagar juros nao abate principal. Quem quita 400 com 20
-- de desconto registra principal 400 e desconto 20 -- a divida extinta e 400, e
-- o que saiu do caixa, 380. Desconto reduz caixa, nao divida; juros aumentam o
-- caixa, nao a divida. O desconto negociado *antes* pertence ao titulo
-- (`valor_desconto`), que ja reduz o valor liquido e, com ele, as parcelas.
COMMENT ON COLUMN titulo_parcela.saldo IS
    'RF-055 - principal em aberto: valor menos o principal ja baixado. Encargos nao entram.';
COMMENT ON COLUMN titulo_parcela.valor_liquidado IS
    'RF-057 - caixa movimentado nas baixas vivas (principal + juros + multa - desconto).';

-- 5.3 Encargos de atraso, calculados em um lugar so.
--
-- Juros ao dia sobre o saldo e multa unica, ambos disparados so depois do
-- vencimento. Ficam no modelo -- e nao no service -- porque a mesma conta e
-- necessaria na posicao da carteira, na inadimplencia e na baixa: tres copias da
-- formula divergem na primeira mudanca de politica de cobranca.
CREATE OR REPLACE FUNCTION fn_dias_atraso(p_vencimento date, p_referencia date DEFAULT current_date)
RETURNS int
LANGUAGE sql IMMUTABLE AS $$
    SELECT greatest((p_referencia - p_vencimento), 0);
$$;

CREATE OR REPLACE FUNCTION fn_encargos_atraso(
    p_saldo          dom_valor,
    p_juros_dia      dom_percentual,
    p_multa          dom_percentual,
    p_dias_atraso    int
) RETURNS dom_valor
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN p_dias_atraso <= 0 OR p_saldo <= 0 THEN 0::dom_valor
        ELSE round(p_saldo * (p_multa / 100)
                 + p_saldo * (p_juros_dia / 100) * p_dias_atraso, 2)::dom_valor
    END;
$$;

COMMENT ON FUNCTION fn_encargos_atraso(dom_valor, dom_percentual, dom_percentual, int) IS
    'RF-055 - multa unica mais juros ao dia sobre o saldo, zerados antes do vencimento.';

-- -----------------------------------------------------------------------------
-- 6. RF-056: controle de aprovacao
--
-- `status_aprovacao` sai de NAO_REQUERIDA/PENDENTE e nao volta: aprovado ou
-- reprovado sao decisoes registradas, e "desaprovar" reabriria a decisao sem
-- deixar o registro de quem a mudou. Rever exige um titulo novo.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_valida_aprovacao_titulo() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_permitido text[];
BEGIN
    IF NEW.status_aprovacao = OLD.status_aprovacao THEN
        RETURN NEW;
    END IF;

    v_permitido := CASE OLD.status_aprovacao
        WHEN 'NAO_REQUERIDA' THEN ARRAY['PENDENTE','APROVADO','CANCELADO']
        WHEN 'PENDENTE'      THEN ARRAY['APROVADO','REPROVADO','CANCELADO']
        ELSE ARRAY[]::text[]
    END;

    IF NOT (NEW.status_aprovacao::text = ANY (v_permitido)) THEN
        RAISE EXCEPTION 'A aprovacao do titulo % nao pode ir de % para % (RF-056).',
            OLD.numero, OLD.status_aprovacao, NEW.status_aprovacao;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_titulo_aprovacao ON titulo;
CREATE TRIGGER trg_titulo_aprovacao
    BEFORE UPDATE ON titulo
    FOR EACH ROW EXECUTE FUNCTION fn_valida_aprovacao_titulo();

-- -----------------------------------------------------------------------------
-- 7. RF-057: a baixa e append-only, e o saldo e derivado dela
--
-- 7.1 Validacao e calculo do lancamento.
--
-- O advisory lock por parcela serializa quem baixa a mesma parcela: sem ele,
-- dois pagamentos simultaneos leem o mesmo saldo e ambos passam pela verificacao
-- de excesso -- a parcela termina paga duas vezes, e o dinheiro ja saiu.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_prepara_baixa() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_parcela record;
    v_titulo  record;
    v_devido  dom_valor;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('titulo_parcela:' || NEW.titulo_parcela_id::text));

    SELECT p.id, p.titulo_id, p.numero_parcela, p.total_parcelas, p.status, p.saldo
      INTO v_parcela
      FROM titulo_parcela p
     WHERE p.id = NEW.titulo_parcela_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Parcela % nao encontrada nesta empresa.', NEW.titulo_parcela_id;
    END IF;

    SELECT t.numero, t.status, t.status_aprovacao INTO v_titulo
      FROM titulo t WHERE t.id = v_parcela.titulo_id;

    IF v_titulo.status = 'CANCELADO' THEN
        RAISE EXCEPTION 'O titulo % esta cancelado e nao aceita baixa (RF-057).', v_titulo.numero;
    END IF;

    -- RF-056: o controle de aprovacao so tem efeito se barrar o pagamento. Um
    -- titulo que espera decisao e um titulo que ainda nao pode ser pago.
    IF v_titulo.status_aprovacao IN ('PENDENTE', 'REPROVADO') THEN
        RAISE EXCEPTION 'O titulo % esta com aprovacao % e nao aceita baixa (RF-056).',
            v_titulo.numero, v_titulo.status_aprovacao;
    END IF;

    -- Estorno: lancamento espelho da baixa original, validado contra ela.
    IF NEW.estorno_de_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM titulo_baixa o
                        WHERE o.id = NEW.estorno_de_id
                          AND o.titulo_parcela_id = NEW.titulo_parcela_id
                          AND NOT o.estornada
                          AND o.estorno_de_id IS NULL) THEN
            RAISE EXCEPTION 'Baixa a estornar inexistente, ja estornada ou de outra parcela (RF-057).';
        END IF;
        NEW.valor_total := NEW.valor_principal + NEW.valor_juros + NEW.valor_multa - NEW.valor_desconto;
        RETURN NEW;
    END IF;

    IF NEW.valor_principal <= 0 THEN
        RAISE EXCEPTION 'A baixa precisa de um valor principal maior que zero (RF-057).';
    END IF;

    IF v_parcela.status IN ('CANCELADA', 'RENEGOCIADA') THEN
        RAISE EXCEPTION 'A parcela %/% esta % e nao aceita baixa (RF-057).',
            v_parcela.numero_parcela, v_parcela.total_parcelas, v_parcela.status;
    END IF;

    -- O teto e o principal em aberto, e so ele. Juros e multa sao acrescimos do
    -- atraso -- entram no caixa, nao na divida -- e o desconto e abatimento do
    -- caixa: quem quita 400 concedendo 20 registra principal 400 e desconto 20.
    v_devido := v_parcela.saldo;
    IF NEW.valor_principal > v_devido THEN
        RAISE EXCEPTION 'Baixa de principal % excede o saldo % da parcela %/% (RF-057).',
            NEW.valor_principal, v_devido,
            v_parcela.numero_parcela, v_parcela.total_parcelas;
    END IF;

    IF NEW.valor_desconto > NEW.valor_principal + NEW.valor_juros + NEW.valor_multa THEN
        RAISE EXCEPTION 'O desconto % supera o valor da baixa da parcela %/% (RF-057).',
            NEW.valor_desconto, v_parcela.numero_parcela, v_parcela.total_parcelas;
    END IF;

    NEW.valor_total := NEW.valor_principal + NEW.valor_juros + NEW.valor_multa - NEW.valor_desconto;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_prepara_baixa() IS
    'RF-056/RF-057 - serializa a parcela, recusa baixa acima do saldo e calcula o valor total.';

DROP TRIGGER IF EXISTS trg_prepara_baixa ON titulo_baixa;
CREATE TRIGGER trg_prepara_baixa
    BEFORE INSERT ON titulo_baixa
    FOR EACH ROW EXECUTE FUNCTION fn_prepara_baixa();

-- 7.2 Append-only, com uma unica excecao nomeada.
--
-- Como no razao de estoque (08) e na trilha de auditoria (05): baixa nao se
-- edita nem se apaga. A unica alteracao aceita e a marcacao de estorno -- e ela
-- e feita pelo trigger da secao 7.3, nao pela aplicacao, que perde o privilegio
-- de UPDATE na secao 10.
CREATE OR REPLACE FUNCTION fn_bloqueia_alteracao_baixa() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Baixa nao pode ser removida (RF-057). Registre o estorno.';
    END IF;

    IF OLD.estornada OR NOT NEW.estornada THEN
        RAISE EXCEPTION 'Baixa nao pode ser alterada (RF-057). Registre o estorno.';
    END IF;

    -- Estornar marca tres colunas e nenhuma outra: valores, parcela, data e
    -- forma de pagamento continuam sendo o que foram no dia do lancamento. O
    -- vinculo bancario (M09/M10) tambem nao passa por aqui -- quando entrar,
    -- entra com um caminho proprio e nomeado, nao afrouxando este.
    IF (NEW.empresa_id, NEW.titulo_parcela_id, NEW.data_baixa, NEW.valor_principal,
        NEW.valor_juros, NEW.valor_multa, NEW.valor_desconto, NEW.valor_total,
        NEW.forma_pagamento_id, NEW.metodo, NEW.estorno_de_id, NEW.criado_em)
       IS DISTINCT FROM
       (OLD.empresa_id, OLD.titulo_parcela_id, OLD.data_baixa, OLD.valor_principal,
        OLD.valor_juros, OLD.valor_multa, OLD.valor_desconto, OLD.valor_total,
        OLD.forma_pagamento_id, OLD.metodo, OLD.estorno_de_id, OLD.criado_em) THEN
        RAISE EXCEPTION 'O estorno so marca a baixa como estornada (RF-057).';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_baixa_imutavel ON titulo_baixa;
CREATE TRIGGER trg_baixa_imutavel
    BEFORE UPDATE OR DELETE ON titulo_baixa
    FOR EACH ROW EXECUTE FUNCTION fn_bloqueia_alteracao_baixa();

-- 7.3 O estorno marca a baixa original.
--
-- SECURITY DEFINER porque a role da aplicacao perde UPDATE sobre `titulo_baixa`
-- (secao 10): marcar a original passa a ser alcancavel *somente* por este
-- caminho -- inserindo o lancamento de estorno. A funcao continua sujeita a RLS
-- (gestao_owner tem FORCE ROW LEVEL SECURITY) e tem search_path fixo.
CREATE OR REPLACE FUNCTION fn_aplica_estorno_baixa() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = gestao, public AS $$
BEGIN
    UPDATE titulo_baixa
       SET estornada      = true,
           estornada_em   = now(),
           motivo_estorno = NEW.motivo_estorno
     WHERE id = NEW.estorno_de_id;

    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION fn_aplica_estorno_baixa() IS
    'RF-057 - o lancamento de estorno marca a baixa original; nada e apagado.';

DROP TRIGGER IF EXISTS trg_aplica_estorno_baixa ON titulo_baixa;
CREATE TRIGGER trg_aplica_estorno_baixa
    AFTER INSERT ON titulo_baixa
    FOR EACH ROW WHEN (NEW.estorno_de_id IS NOT NULL)
    EXECUTE FUNCTION fn_aplica_estorno_baixa();

-- 7.4 Saldos derivados: parcela a partir das baixas, titulo a partir das parcelas.
--
-- Substitui a versao de 03, que tinha tres defeitos:
--   a) somava a baixa de estorno como se fosse pagamento -- estornar aumentava o
--      valor liquidado em vez de devolve-lo;
--   b) abatia o principal com o caixa: uma baixa de 150 com 9,32 de juros
--      deixava a parcela de 400 com saldo 240,68, como se pagar mora quitasse
--      divida;
--   c) decidia o status do titulo comparando o liquidado com `valor_liquido`.
--      Como o liquidado inclui os encargos, um titulo pago com mora ficava
--      "LIQUIDADO" antes de a ultima parcela ser paga.
-- Agora sao dois numeros distintos -- principal em aberto e caixa movimentado --
-- e o titulo e o retrato das suas parcelas, nada mais.
CREATE OR REPLACE FUNCTION fn_recalcula_saldos_titulo() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = gestao, public AS $$
DECLARE
    v_parcela uuid := coalesce(NEW.titulo_parcela_id, OLD.titulo_parcela_id);
    v_titulo  uuid;
BEGIN
    -- Baixas estornadas e os proprios lancamentos de estorno saem da conta: o
    -- par (baixa, estorno) precisa somar zero, e nao o dobro.
    UPDATE titulo_parcela p
       SET valor_liquidado = sub.caixa,
           valor_juros     = sub.juros,
           valor_multa     = sub.multa,
           valor_desconto  = sub.desconto,
           saldo           = greatest(p.valor - sub.principal, 0),
           status = CASE
                        WHEN p.status IN ('CANCELADA','RENEGOCIADA') THEN p.status
                        WHEN sub.principal >= p.valor THEN 'LIQUIDADA'::enum_status_parcela
                        WHEN sub.principal > 0        THEN 'PARCIALMENTE_LIQUIDADA'::enum_status_parcela
                        ELSE 'ABERTA'::enum_status_parcela
                    END,
           data_liquidacao = CASE WHEN sub.principal >= p.valor THEN sub.ultima_baixa END
      FROM (
            SELECT coalesce(sum(b.valor_principal), 0)                            AS principal,
                   coalesce(sum(b.valor_total), 0)                                AS caixa,
                   coalesce(sum(b.valor_juros), 0)                                AS juros,
                   coalesce(sum(b.valor_multa), 0)                                AS multa,
                   coalesce(sum(b.valor_desconto), 0)                             AS desconto,
                   max(b.data_baixa)                                              AS ultima_baixa
              FROM titulo_baixa b
             WHERE b.titulo_parcela_id = v_parcela
               AND NOT b.estornada
               AND b.estorno_de_id IS NULL
           ) sub
     WHERE p.id = v_parcela
    RETURNING p.titulo_id INTO v_titulo;

    UPDATE titulo t
       SET valor_liquidado = sub.liquidado,
           saldo           = sub.em_aberto,
           status = CASE
                        WHEN t.status IN ('CANCELADO','RENEGOCIADO') THEN t.status
                        WHEN sub.abertas = 0 THEN 'LIQUIDADO'::enum_status_titulo
                        WHEN sub.liquidado > 0 THEN 'PARCIALMENTE_LIQUIDADO'::enum_status_titulo
                        ELSE 'ABERTO'::enum_status_titulo
                    END
      FROM (
            SELECT coalesce(sum(p.valor_liquidado), 0) AS liquidado,
                   coalesce(sum(p.saldo) FILTER (WHERE p.status <> 'CANCELADA'), 0) AS em_aberto,
                   count(*) FILTER (WHERE p.status NOT IN ('LIQUIDADA','CANCELADA')) AS abertas
              FROM titulo_parcela p
             WHERE p.titulo_id = v_titulo
           ) sub
     WHERE t.id = v_titulo;

    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION fn_recalcula_saldos_titulo() IS
    'RF-057/RF-058 - projeta a parcela a partir das baixas vivas e o titulo a partir das parcelas.';

-- O trigger ja existe desde 03 sobre INSERT/UPDATE/DELETE; recriado aqui para
-- garantir que aponta para a funcao corrigida mesmo em bancos antigos.
DROP TRIGGER IF EXISTS trg_recalcula_saldos_titulo ON titulo_baixa;
CREATE TRIGGER trg_recalcula_saldos_titulo
    AFTER INSERT OR UPDATE ON titulo_baixa
    FOR EACH ROW EXECUTE FUNCTION fn_recalcula_saldos_titulo();

-- 7.5 Barreiras declarativas: o que o trigger calcula, o CHECK confere.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.titulo_baixa'::regclass
                      AND conname = 'ck_baixa_estorno') THEN
        ALTER TABLE titulo_baixa ADD CONSTRAINT ck_baixa_estorno
            CHECK (estorno_de_id IS NULL OR estorno_de_id <> id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.titulo_baixa'::regclass
                      AND conname = 'ck_baixa_encargos') THEN
        ALTER TABLE titulo_baixa ADD CONSTRAINT ck_baixa_encargos
            CHECK (valor_juros >= 0 AND valor_multa >= 0 AND valor_desconto >= 0);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.titulo_parcela'::regclass
                      AND conname = 'ck_parcela_encargos') THEN
        ALTER TABLE titulo_parcela ADD CONSTRAINT ck_parcela_encargos
            CHECK (valor_juros >= 0 AND valor_multa >= 0 AND valor_desconto >= 0
               AND percentual_juros_dia >= 0 AND percentual_multa >= 0);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.titulo'::regclass
                      AND conname = 'ck_titulo_cancelamento') THEN
        ALTER TABLE titulo ADD CONSTRAINT ck_titulo_cancelamento
            CHECK (status <> 'CANCELADO' OR motivo_cancelamento IS NOT NULL);
    END IF;
END $$;

-- Uma unica linha de estorno por baixa: o indice fecha a janela que restaria
-- entre a verificacao do trigger e o commit de duas transacoes simultaneas.
CREATE UNIQUE INDEX IF NOT EXISTS ux_baixa_estorno_unico
    ON titulo_baixa (estorno_de_id) WHERE estorno_de_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 8. RF-058: posicao da carteira e inadimplencia
--
-- A regra de "o que esta vencido, ha quantos dias e quanto custa hoje" vive no
-- modelo, como o alerta de estoque minimo (01). O aging em faixas acompanha:
-- e a leitura que separa atraso operacional de perda provavel.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_parcela_posicao AS
SELECT p.empresa_id,
       p.id                          AS titulo_parcela_id,
       t.id                          AS titulo_id,
       t.tipo,
       t.numero,
       t.descricao,
       t.filial_id,
       t.parceiro_id,
       t.funcionario_id,
       t.categoria_financeira_id,
       t.centro_custo_id,
       t.status_aprovacao,
       p.numero_parcela,
       p.total_parcelas,
       p.data_vencimento,
       p.data_vencimento_original,
       p.valor,
       p.valor_liquidado,
       p.saldo,
       p.status,
       fn_dias_atraso(p.data_vencimento)                       AS dias_atraso,
       fn_encargos_atraso(p.saldo, p.percentual_juros_dia,
                          p.percentual_multa,
                          fn_dias_atraso(p.data_vencimento))   AS encargos,
       p.saldo + fn_encargos_atraso(p.saldo, p.percentual_juros_dia,
                                    p.percentual_multa,
                                    fn_dias_atraso(p.data_vencimento)) AS valor_atualizado,
       CASE
           WHEN fn_dias_atraso(p.data_vencimento) = 0  THEN 'A_VENCER'
           WHEN fn_dias_atraso(p.data_vencimento) <= 30 THEN 'ATE_30'
           WHEN fn_dias_atraso(p.data_vencimento) <= 60 THEN 'DE_31_A_60'
           WHEN fn_dias_atraso(p.data_vencimento) <= 90 THEN 'DE_61_A_90'
           ELSE 'ACIMA_DE_90'
       END                                                     AS faixa_atraso
  FROM titulo_parcela p
  JOIN titulo t ON t.id = p.titulo_id
 WHERE t.status <> 'CANCELADO'
   AND p.status IN ('ABERTA', 'PARCIALMENTE_LIQUIDADA');

COMMENT ON VIEW vw_parcela_posicao IS
    'RF-055/RF-058 - parcelas em aberto com dias de atraso, encargos e faixa de aging.';

CREATE OR REPLACE VIEW vw_inadimplencia AS
SELECT * FROM vw_parcela_posicao WHERE dias_atraso > 0;

COMMENT ON VIEW vw_inadimplencia IS
    'RF-058 - subconjunto vencido da carteira, por parcela.';

CREATE INDEX IF NOT EXISTS ix_titulo_parcela_empresa_status
    ON titulo_parcela (empresa_id, status, data_vencimento);

CREATE INDEX IF NOT EXISTS ix_titulo_aprovacao
    ON titulo (empresa_id, status_aprovacao) WHERE status_aprovacao = 'PENDENTE';

CREATE INDEX IF NOT EXISTS ix_titulo_recorrencia
    ON titulo (recorrencia_id) WHERE recorrencia_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_recorrencia_geracao
    ON recorrencia (empresa_id, proxima_geracao) WHERE ativo;

-- -----------------------------------------------------------------------------
-- 9. RF-053: recorrencia
--
-- A data da proxima geracao e do modelo, nao do chamador: se cada cliente
-- calcular o proximo vencimento, dois deles vao discordar sobre o que e "mes que
-- vem" no dia 31. `dia_vencimento` fixa o dia desejado e o menor entre ele e o
-- ultimo dia do mes resolve fevereiro sem inventar 30/02.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_proxima_ocorrencia(
    p_base          date,
    p_periodicidade enum_periodicidade,
    p_dia_vencimento smallint DEFAULT NULL
) RETURNS date
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    v_intervalo interval;
    v_proxima   date;
BEGIN
    v_intervalo := CASE p_periodicidade
        WHEN 'DIARIA'     THEN interval '1 day'
        WHEN 'SEMANAL'    THEN interval '7 days'
        WHEN 'QUINZENAL'  THEN interval '15 days'
        WHEN 'MENSAL'     THEN interval '1 month'
        WHEN 'BIMESTRAL'  THEN interval '2 months'
        WHEN 'TRIMESTRAL' THEN interval '3 months'
        WHEN 'SEMESTRAL'  THEN interval '6 months'
        WHEN 'ANUAL'      THEN interval '1 year'
    END;

    -- UNICA nao se repete: quem pergunta pela proxima ocorrencia de algo que
    -- acontece uma vez precisa receber "nao ha", e nao uma data qualquer.
    IF v_intervalo IS NULL THEN
        RETURN NULL;
    END IF;

    v_proxima := (p_base + v_intervalo)::date;

    IF p_dia_vencimento IS NOT NULL AND p_periodicidade IN
       ('MENSAL','BIMESTRAL','TRIMESTRAL','SEMESTRAL','ANUAL') THEN
        v_proxima := date_trunc('month', v_proxima)::date
                     + least(p_dia_vencimento,
                             extract(day from (date_trunc('month', v_proxima)
                                               + interval '1 month - 1 day'))::int) - 1;
    END IF;

    RETURN v_proxima;
END;
$$;

COMMENT ON FUNCTION fn_proxima_ocorrencia(date, enum_periodicidade, smallint) IS
    'RF-053 - proxima data de geracao da recorrencia; NULL para periodicidade UNICA.';

-- -----------------------------------------------------------------------------
-- 10. Privilegios: a baixa e a unica porta de entrada da liquidacao
--
-- Retirar UPDATE e DELETE de `titulo_baixa` da role da aplicacao e a segunda
-- barreira do append-only: um trigger pode ser desabilitado por quem tem direito
-- sobre a tabela; um GRANT ausente, nao. A marcacao de estorno continua possivel
-- porque quem a executa e o trigger SECURITY DEFINER da secao 7.3.
-- -----------------------------------------------------------------------------
DO $$
DECLARE r text;
BEGIN
    FOREACH r IN ARRAY ARRAY['app_gestao', 'sge_api'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON gestao.titulo_baixa FROM %I;', r);
            EXECUTE format('GRANT SELECT, INSERT ON gestao.titulo_baixa TO %I;', r);

            EXECUTE format(
                'GRANT EXECUTE ON FUNCTION gestao.fn_proximo_numero_titulo(uuid, enum_tipo_titulo) TO %I;', r);
            EXECUTE format(
                'GRANT EXECUTE ON FUNCTION gestao.fn_proxima_ocorrencia(date, enum_periodicidade, smallint) TO %I;', r);
            EXECUTE format('GRANT SELECT ON gestao.vw_parcela_posicao TO %I;', r);
            EXECUTE format('GRANT SELECT ON gestao.vw_inadimplencia TO %I;', r);
        END IF;
    END LOOP;
END $$;

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
    v_views    int;
    v_gravavel int;
BEGIN
    SELECT count(*) INTO v_triggers
      FROM pg_trigger
     WHERE NOT tgisinternal
       AND tgname IN ('trg_prepara_titulo','trg_titulo_parcelas_somam','trg_parcela_soma_titulo',
                      'trg_prepara_parcela','trg_titulo_aprovacao','trg_prepara_baixa',
                      'trg_baixa_imutavel','trg_aplica_estorno_baixa','trg_recalcula_saldos_titulo',
                      'trg_recorrencia_auditoria');
    IF v_triggers < 10 THEN
        RAISE WARNING 'regras do M08 incompletas (% de 10)', v_triggers; v_falhas := v_falhas + 1;
    END IF;

    SELECT count(*) INTO v_fks
      FROM pg_constraint
     WHERE contype = 'f' AND conname LIKE 'fk\_%\_tenant';
    IF v_fks < 63 THEN
        RAISE WARNING 'FKs multiempresa incompletas (% de 63)', v_fks; v_falhas := v_falhas + 1;
    END IF;

    SELECT count(*) INTO v_views
      FROM pg_views
     WHERE schemaname = 'gestao'
       AND viewname IN ('vw_parcela_posicao','vw_inadimplencia');
    IF v_views < 2 THEN
        RAISE WARNING 'visoes da carteira ausentes (% de 2)', v_views; v_falhas := v_falhas + 1;
    END IF;

    SELECT count(*) INTO v_gravavel
      FROM information_schema.table_privileges
     WHERE table_schema = 'gestao'
       AND table_name = 'titulo_baixa'
       AND grantee IN ('app_gestao','sge_api')
       AND privilege_type IN ('UPDATE','DELETE');
    IF v_gravavel > 0 THEN
        RAISE WARNING 'baixa ainda alteravel pela aplicacao (% privilegios)', v_gravavel;
        v_falhas := v_falhas + 1;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_proc
                    WHERE pronamespace = 'gestao'::regnamespace
                      AND proname = 'fn_proximo_numero_titulo') THEN
        RAISE WARNING 'numeracao do titulo ausente (RF-051/RF-052)'; v_falhas := v_falhas + 1;
    END IF;

    IF v_falhas = 0 THEN
        RAISE NOTICE 'M08 - Contas a Pagar e Receber: ajustes aplicados com sucesso.';
    END IF;
END $$;
