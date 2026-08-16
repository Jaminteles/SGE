-- =============================================================================
-- 10_fluxo_caixa_sprint7.sql
-- Sprint 7 - Fase 3 (Financeiro): M14 - Fluxo de Caixa e Planejamento
-- (RF-101 a RF-105).
--
-- Executar como gestao_owner, depois de 01 a 09:
--   psql -U gestao_owner -h localhost -d gestao_empresarial -f 10_fluxo_caixa_sprint7.sql
-- Idempotente: pode ser reexecutado.
--
-- O que 03 ja entregava: as tabelas (cenario_fluxo_caixa, projecao_fluxo_caixa,
-- alerta_caixa), a RLS por empresa e uma primeira `vw_fluxo_caixa`. Este script
-- fecha o que faltava para o fluxo de caixa ser confiavel:
--   1. RN-010 - trilha de auditoria nas tres tabelas do modulo
--   2. RN-001 - referencias presas a mesma empresa (FK composta)
--   3. RF-104 - cenario com premissas validadas, base unica por empresa e
--                projecao manual limitada a janela do cenario
--   4. RF-101/RF-103 - fluxo consolidado refeito: realizado na data em que o
--                dinheiro andou, previsto e vencido pelo que ainda esta aberto
--   5. RF-102 - agregacao diaria pronta para projetar por periodo
--   6. RF-105 - saldo de caixa e alerta de insuficiencia
--
-- Decisao estrutural: o fluxo de caixa nao e uma tabela. Salvo o que um humano
-- digita (`projecao_fluxo_caixa`, sempre dentro de um cenario), tudo o que se ve
-- e projecao dos titulos e das baixas -- porque "quanto entra em novembro" muda
-- a cada baixa registrada, e um numero gravado ontem estaria errado hoje sem que
-- ninguem tivesse errado nada. E a mesma escolha do saldo do titulo (09) e do
-- razao de estoque (08).
--
-- A `vw_fluxo_caixa` de 03 tinha dois defeitos que este script corrige:
--   a) datava o realizado no vencimento da parcela, nao na data da baixa -- um
--      titulo vencido em marco e pago em maio aparecia como caixa de marco;
--   b) somava as baixas estornadas, contando dinheiro que voltou.
-- =============================================================================
SET search_path = gestao, public;

-- -----------------------------------------------------------------------------
-- 1. RN-010: auditoria do planejamento
--
-- Cenario, projecao manual e alerta sao decisoes de planejamento, nao fatos
-- calculados: quem afrouxou o saldo minimo de 50 mil para 5 mil na vespera de um
-- pagamento grande precisa aparecer na trilha tanto quanto quem lancou o titulo.
-- -----------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['cenario_fluxo_caixa','projecao_fluxo_caixa','alerta_caixa'] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_auditoria ON gestao.%1$I;', t);
        EXECUTE format(
            'CREATE TRIGGER trg_%1$s_auditoria
                 AFTER INSERT OR UPDATE OR DELETE ON gestao.%1$I
                 FOR EACH ROW EXECUTE FUNCTION fn_auditoria_generica();', t);
    END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 2. RN-001: referencia cruzada entre empresas
--
-- Mesma tecnica de 06 a 09: chave candidata (empresa_id, id) no destino e FK
-- composta (empresa_id, <coluna>) na origem. Sem ela, uma projecao da empresa A
-- poderia pendurar-se no cenario da empresa B -- e o planejamento de uma
-- apareceria dentro do da outra, que e exatamente o que a RLS existe para
-- impedir.
-- -----------------------------------------------------------------------------
-- 2.1 Chave candidata (empresa_id, id) nas tabelas referenciadas aqui.
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['cenario_fluxo_caixa','conta_bancaria'] LOOP
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
-- Como nos scripts anteriores, o que era `ON DELETE SET NULL` vira `RESTRICT`:
-- o PostgreSQL 14 nao aceita SET NULL em FK composta. A projecao manual segue
-- em CASCADE -- ela e parte do cenario, e apagar o cenario apaga o rascunho
-- inteiro, nao deixa linhas orfas com data e valor.
DO $$
DECLARE
    r record;
    c record;
BEGIN
    FOR r IN
        SELECT * FROM (VALUES
            ('projecao_fluxo_caixa', 'cenario_id',              'cenario_fluxo_caixa',  'CASCADE'),
            ('projecao_fluxo_caixa', 'categoria_financeira_id', 'categoria_financeira', 'RESTRICT'),
            ('projecao_fluxo_caixa', 'centro_custo_id',         'centro_custo',         'RESTRICT'),
            ('alerta_caixa',         'conta_bancaria_id',       'conta_bancaria',       'CASCADE')
        ) AS t(tabela, coluna, referencia, acao)
    LOOP
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
                     FOREIGN KEY (empresa_id, %2$I)
                     REFERENCES gestao.%3$I (empresa_id, id) ON DELETE %4$s;',
                r.tabela, r.coluna, r.referencia, r.acao);
        END IF;
    END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 3. RF-104: cenario e projecao manual
--
-- 3.1 Colunas que faltavam para o cenario e o alerta serem administraveis.
--
-- `alerta_caixa` nasceu em 03 sem nome, sem autor e sem data de alteracao: sem
-- isso a trilha de auditoria mostra "alguem mudou o alerta <uuid>", que nao e
-- uma informacao util para quem precisa entender por que o aviso parou de sair.
-- -----------------------------------------------------------------------------
ALTER TABLE alerta_caixa
    ADD COLUMN IF NOT EXISTS nome          varchar(120),
    ADD COLUMN IF NOT EXISTS criado_por    uuid REFERENCES usuario(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS atualizado_em timestamptz NOT NULL DEFAULT now();

UPDATE alerta_caixa SET nome = 'Alerta de caixa' WHERE nome IS NULL;
ALTER TABLE alerta_caixa ALTER COLUMN nome SET NOT NULL;

-- 3.2 Um cenario base por empresa.
--
-- O cenario base e a resposta a "e se nada mudar": e contra ele que os outros
-- sao lidos. Dois cenarios base nao seriam dois planos, seriam uma pergunta sem
-- resposta -- o indice parcial fecha a janela entre duas transacoes que marcam
-- o seu como base ao mesmo tempo.
CREATE UNIQUE INDEX IF NOT EXISTS ux_cenario_base
    ON cenario_fluxo_caixa (empresa_id) WHERE base;

-- 3.3 Premissas: chaves conhecidas, valores numericos e limites explicitos.
--
-- `premissas` e jsonb porque o conjunto de hipoteses cresce com o negocio, mas
-- jsonb livre vira campo de texto: um "entradasPercentual" escrito como string,
-- ou um -400% digitado sem querer, so apareceria como um saldo projetado
-- absurdo, meses depois, sem ninguem saber de onde veio. As duas hipoteses de
-- hoje ajustam o que ainda nao aconteceu:
--   entradas_percentual / saidas_percentual - variacao (%) aplicada sobre o
--   PREVISTO, entre -100 e 100. O realizado nao entra: fato nao se estima.
CREATE OR REPLACE FUNCTION fn_valida_premissas_cenario() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_chave  text;
    v_valor  jsonb;
    v_numero numeric;
BEGIN
    IF jsonb_typeof(NEW.premissas) <> 'object' THEN
        RAISE EXCEPTION 'As premissas do cenario precisam ser um objeto JSON (RF-104).';
    END IF;

    FOR v_chave, v_valor IN SELECT * FROM jsonb_each(NEW.premissas) LOOP
        IF v_chave NOT IN ('entradas_percentual', 'saidas_percentual') THEN
            RAISE EXCEPTION 'Premissa desconhecida "%" (RF-104). Aceitas: entradas_percentual, saidas_percentual.', v_chave;
        END IF;

        IF jsonb_typeof(v_valor) <> 'number' THEN
            RAISE EXCEPTION 'A premissa "%" precisa ser um numero (RF-104).', v_chave;
        END IF;

        v_numero := v_valor::text::numeric;
        IF v_numero < -100 OR v_numero > 100 THEN
            RAISE EXCEPTION 'A premissa "%" deve ficar entre -100 e 100 (RF-104). Recebido: %.',
                v_chave, v_numero;
        END IF;
    END LOOP;

    NEW.atualizado_em := now();
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_valida_premissas_cenario() IS
    'RF-104 - aceita apenas premissas conhecidas, numericas e dentro de faixa.';

DROP TRIGGER IF EXISTS trg_valida_premissas_cenario ON cenario_fluxo_caixa;
CREATE TRIGGER trg_valida_premissas_cenario
    BEFORE INSERT OR UPDATE ON cenario_fluxo_caixa
    FOR EACH ROW EXECUTE FUNCTION fn_valida_premissas_cenario();

-- 3.4 A projecao manual e sempre de um cenario, e sempre uma hipotese.
--
-- Tres regras, uma ideia so: `projecao_fluxo_caixa` guarda o que alguem digitou
-- ("vou comprar uma maquina em marco"), nunca o que o sistema calcula. Por isso
-- ela exige cenario, recusa data fora da janela dele e so aceita PREVISTO --
-- REALIZADO nasce de baixa, VENCIDO nasce do relogio, e nenhum dos dois se
-- digita. Sem a primeira regra, uma linha sem cenario apareceria somada ao
-- consolidado real sem nada indicando que e um palpite.
CREATE OR REPLACE FUNCTION fn_valida_projecao_manual() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_cenario record;
BEGIN
    IF NEW.cenario_id IS NULL THEN
        RAISE EXCEPTION 'A projecao manual pertence a um cenario (RF-104).';
    END IF;

    SELECT data_inicio, data_fim INTO v_cenario
      FROM cenario_fluxo_caixa WHERE id = NEW.cenario_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cenario % nao encontrado nesta empresa (RF-104).', NEW.cenario_id;
    END IF;

    IF NEW.data_referencia < v_cenario.data_inicio
       OR NEW.data_referencia > v_cenario.data_fim THEN
        RAISE EXCEPTION 'A data % esta fora da janela do cenario (% a %) (RF-104).',
            NEW.data_referencia, v_cenario.data_inicio, v_cenario.data_fim;
    END IF;

    IF NEW.situacao <> 'PREVISTO' THEN
        RAISE EXCEPTION 'Projecao manual e sempre PREVISTA (RF-103): realizado vem da baixa.';
    END IF;

    IF NEW.valor <= 0 THEN
        RAISE EXCEPTION 'A projecao precisa de um valor maior que zero (RF-104). A direcao vem do tipo (PAGAR/RECEBER).';
    END IF;

    NEW.manual := true;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_valida_projecao_manual() IS
    'RF-104 - projecao manual: exige cenario, respeita a janela e so aceita PREVISTO.';

DROP TRIGGER IF EXISTS trg_valida_projecao_manual ON projecao_fluxo_caixa;
CREATE TRIGGER trg_valida_projecao_manual
    BEFORE INSERT OR UPDATE ON projecao_fluxo_caixa
    FOR EACH ROW EXECUTE FUNCTION fn_valida_projecao_manual();

-- -----------------------------------------------------------------------------
-- 4. RF-101 / RF-103: o fluxo consolidado
--
-- Uma linha por movimento de caixa, com a situacao que o separa:
--   REALIZADO - baixa viva, na data em que o dinheiro andou;
--   VENCIDO   - parcela em aberto com vencimento no passado;
--   PREVISTO  - parcela em aberto com vencimento hoje ou a frente.
--
-- Baixa viva e a mesma definicao de 09: nem estornada, nem lancamento de
-- estorno. O par (baixa, estorno) some do caixa realizado em vez de aparecer
-- duas vezes -- se aparecesse, o realizado do mes cresceria a cada erro
-- corrigido. O rastro de que houve estorno continua em `titulo_baixa`.
--
-- `valor` e sempre positivo: a direcao esta em `tipo` (PAGAR sai, RECEBER
-- entra). Guardar o sinal em duas colunas convida a somas que se cancelam sem
-- que ninguem perceba.
-- -----------------------------------------------------------------------------
-- DROP antes de criar: `CREATE OR REPLACE VIEW` so aceita acrescentar colunas no
-- fim, e esta versao muda a lista da visao de 03. CASCADE porque a visao diaria
-- da secao 5 depende dela -- as duas sao recriadas aqui, na ordem.
DROP VIEW IF EXISTS vw_fluxo_caixa CASCADE;

CREATE VIEW vw_fluxo_caixa AS
-- Realizado: o caixa efetivamente movimentado, na data da baixa.
SELECT b.empresa_id,
       t.filial_id,
       b.data_baixa                          AS data_referencia,
       t.tipo,
       'REALIZADO'::enum_realizacao          AS situacao,
       t.categoria_financeira_id,
       t.centro_custo_id,
       t.parceiro_id,
       t.id                                  AS titulo_id,
       p.id                                  AS titulo_parcela_id,
       NULL::uuid                            AS cenario_id,
       b.valor_total                         AS valor,
       t.descricao,
       false                                 AS manual
  FROM titulo_baixa b
  JOIN titulo_parcela p ON p.id = b.titulo_parcela_id
  JOIN titulo t         ON t.id = p.titulo_id
 WHERE NOT b.estornada
   AND b.estorno_de_id IS NULL
   AND t.status <> 'CANCELADO'

UNION ALL

-- Em aberto: o principal que ainda vai andar, na data em que deveria andar.
-- Titulo pendente de aprovacao (RF-056) fica de fora: nao pode ser pago, e
-- planejar caixa com ele e planejar com dinheiro que talvez nunca saia.
SELECT p.empresa_id,
       t.filial_id,
       p.data_vencimento                     AS data_referencia,
       t.tipo,
       CASE WHEN p.data_vencimento < current_date
            THEN 'VENCIDO'::enum_realizacao
            ELSE 'PREVISTO'::enum_realizacao
       END                                   AS situacao,
       t.categoria_financeira_id,
       t.centro_custo_id,
       t.parceiro_id,
       t.id                                  AS titulo_id,
       p.id                                  AS titulo_parcela_id,
       NULL::uuid                            AS cenario_id,
       p.saldo                               AS valor,
       t.descricao,
       false                                 AS manual
  FROM titulo_parcela p
  JOIN titulo t ON t.id = p.titulo_id
 WHERE t.status <> 'CANCELADO'
   AND p.status IN ('ABERTA', 'PARCIALMENTE_LIQUIDADA')
   AND t.status_aprovacao NOT IN ('PENDENTE', 'REPROVADO')
   AND p.saldo > 0

UNION ALL

-- Hipoteses digitadas (RF-104): so aparecem quando o cenario e escolhido, por
-- isso `cenario_id` vem preenchido e quem consulta o consolidado real filtra
-- `cenario_id IS NULL`.
SELECT j.empresa_id,
       NULL::uuid                            AS filial_id,
       j.data_referencia,
       j.tipo,
       j.situacao,
       j.categoria_financeira_id,
       j.centro_custo_id,
       NULL::uuid                            AS parceiro_id,
       NULL::uuid                            AS titulo_id,
       NULL::uuid                            AS titulo_parcela_id,
       j.cenario_id,
       j.valor,
       j.descricao,
       true                                  AS manual
  FROM projecao_fluxo_caixa j;

COMMENT ON VIEW vw_fluxo_caixa IS
    'RF-101/RF-103 - movimentos de caixa realizados, previstos, vencidos e projetados; valor sempre positivo, direcao no tipo.';

-- -----------------------------------------------------------------------------
-- 5. RF-102: agregacao diaria
--
-- O dia e o menor grao util do fluxo: semana, mes e trimestre saem dele por
-- soma, e nenhuma pergunta de planejamento precisa da hora em que a baixa foi
-- digitada. Agregar aqui evita que cada consulta por periodo carregue de volta
-- todas as parcelas da carteira.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS vw_fluxo_caixa_diario;

CREATE VIEW vw_fluxo_caixa_diario AS
SELECT empresa_id,
       filial_id,
       cenario_id,
       data_referencia,
       situacao,
       categoria_financeira_id,
       centro_custo_id,
       -- coalesce porque `sum ... FILTER` devolve NULL quando o grupo so tem
       -- movimentos do outro sentido: um dia so de pagamentos traria entradas
       -- nulas, e NULL somado a qualquer coisa apaga o total de quem consome.
       coalesce(sum(valor) FILTER (WHERE tipo = 'RECEBER'), 0) AS entradas,
       coalesce(sum(valor) FILTER (WHERE tipo = 'PAGAR'), 0)   AS saidas,
       count(*)                                                AS movimentos
  FROM vw_fluxo_caixa
 GROUP BY empresa_id, filial_id, cenario_id, data_referencia, situacao,
          categoria_financeira_id, centro_custo_id;

COMMENT ON VIEW vw_fluxo_caixa_diario IS
    'RF-102 - entradas e saidas por dia, situacao e classificacao; base das projecoes por periodo.';

-- Indices que sustentam as duas visoes.
CREATE INDEX IF NOT EXISTS ix_titulo_baixa_data
    ON titulo_baixa (empresa_id, data_baixa) WHERE NOT estornada AND estorno_de_id IS NULL;

CREATE INDEX IF NOT EXISTS ix_titulo_parcela_vencimento
    ON titulo_parcela (empresa_id, data_vencimento)
 WHERE status IN ('ABERTA', 'PARCIALMENTE_LIQUIDADA');

CREATE INDEX IF NOT EXISTS ix_projecao_cenario
    ON projecao_fluxo_caixa (cenario_id, data_referencia);

-- -----------------------------------------------------------------------------
-- 6. RF-105: saldo de caixa e alerta de insuficiencia
--
-- 6.1 De onde sai o "saldo de hoje".
--
-- Da conta bancaria (M09): e o unico numero do modelo que diz quanto ha em
-- caixa agora. Enquanto a Sprint 10 nao liga baixa a conta, o alerta com conta
-- informada usa o saldo daquela conta como ponto de partida, e o alerta sem
-- conta soma as contas ativas -- em ambos os casos a projecao dos movimentos e
-- da empresa inteira, porque e essa a granularidade que existe hoje.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_saldo_caixa_atual(
    p_empresa_id uuid,
    p_conta_id   uuid DEFAULT NULL
) RETURNS dom_valor
LANGUAGE sql STABLE AS $$
    SELECT coalesce(sum(c.saldo_atual), 0)::dom_valor
      FROM conta_bancaria c
     WHERE c.empresa_id = p_empresa_id
       AND c.ativo
       AND (p_conta_id IS NULL OR c.id = p_conta_id);
$$;

COMMENT ON FUNCTION fn_saldo_caixa_atual(uuid, uuid) IS
    'RF-105 - saldo disponivel hoje: a conta informada ou a soma das contas ativas.';

-- 6.2 Limites do alerta.
--
-- Um alerta com antecedencia zero avisa no dia em que o dinheiro falta, o que e
-- tarde demais para ser um alerta; um com dois anos de horizonte projeta sobre
-- titulos que ainda nem existem e dispara sempre. A faixa mantem o aviso dentro
-- do que a carteira ja consegue prever.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.alerta_caixa'::regclass
                      AND conname = 'ck_alerta_caixa_antecedencia') THEN
        ALTER TABLE alerta_caixa ADD CONSTRAINT ck_alerta_caixa_antecedencia
            CHECK (dias_antecedencia BETWEEN 1 AND 180);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.alerta_caixa'::regclass
                      AND conname = 'ck_alerta_caixa_saldo_minimo') THEN
        ALTER TABLE alerta_caixa ADD CONSTRAINT ck_alerta_caixa_saldo_minimo
            CHECK (saldo_minimo >= 0);
    END IF;
END $$;

-- Um alerta ativo por conta (e um so para "a empresa toda", com conta nula):
-- dois alertas sobre o mesmo caixa produzem dois avisos do mesmo problema, e o
-- segundo ensina a ignorar o primeiro.
CREATE UNIQUE INDEX IF NOT EXISTS ux_alerta_caixa_conta
    ON alerta_caixa (empresa_id, conta_bancaria_id) WHERE ativo AND conta_bancaria_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_alerta_caixa_empresa
    ON alerta_caixa (empresa_id) WHERE ativo AND conta_bancaria_id IS NULL;

CREATE OR REPLACE FUNCTION fn_alerta_caixa_atualizado_em() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.atualizado_em := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_alerta_caixa_atualizado_em ON alerta_caixa;
CREATE TRIGGER trg_alerta_caixa_atualizado_em
    BEFORE UPDATE ON alerta_caixa
    FOR EACH ROW EXECUTE FUNCTION fn_alerta_caixa_atualizado_em();

-- -----------------------------------------------------------------------------
-- 7. Privilegios das visoes e funcoes criadas aqui.
-- -----------------------------------------------------------------------------
DO $$
DECLARE r text;
BEGIN
    FOREACH r IN ARRAY ARRAY['app_gestao', 'sge_api'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('GRANT SELECT ON gestao.vw_fluxo_caixa TO %I;', r);
            EXECUTE format('GRANT SELECT ON gestao.vw_fluxo_caixa_diario TO %I;', r);
            EXECUTE format(
                'GRANT EXECUTE ON FUNCTION gestao.fn_saldo_caixa_atual(uuid, uuid) TO %I;', r);
        END IF;
    END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 8. Reaplica o search_path fixo exigido por 04 nas funcoes criadas aqui.
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
-- 9. Verificacao
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_falhas   int := 0;
    v_triggers int;
    v_fks      int;
    v_views    int;
    v_indices  int;
    v_rls      int;
BEGIN
    SELECT count(*) INTO v_triggers
      FROM pg_trigger
     WHERE NOT tgisinternal
       AND tgname IN ('trg_cenario_fluxo_caixa_auditoria','trg_projecao_fluxo_caixa_auditoria',
                      'trg_alerta_caixa_auditoria','trg_valida_premissas_cenario',
                      'trg_valida_projecao_manual','trg_alerta_caixa_atualizado_em');
    IF v_triggers < 6 THEN
        RAISE WARNING 'regras do M14 incompletas (% de 6)', v_triggers; v_falhas := v_falhas + 1;
    END IF;

    SELECT count(*) INTO v_fks
      FROM pg_constraint
     WHERE contype = 'f'
       AND conname IN ('fk_projecao_fluxo_caixa_cenario_id_tenant',
                       'fk_projecao_fluxo_caixa_categoria_financeira_id_tenant',
                       'fk_projecao_fluxo_caixa_centro_custo_id_tenant',
                       'fk_alerta_caixa_conta_bancaria_id_tenant');
    IF v_fks < 4 THEN
        RAISE WARNING 'FKs multiempresa do M14 incompletas (% de 4)', v_fks; v_falhas := v_falhas + 1;
    END IF;

    SELECT count(*) INTO v_views
      FROM pg_views
     WHERE schemaname = 'gestao'
       AND viewname IN ('vw_fluxo_caixa','vw_fluxo_caixa_diario');
    IF v_views < 2 THEN
        RAISE WARNING 'visoes do fluxo de caixa ausentes (% de 2)', v_views; v_falhas := v_falhas + 1;
    END IF;

    SELECT count(*) INTO v_indices
      FROM pg_indexes
     WHERE schemaname = 'gestao'
       AND indexname IN ('ux_cenario_base','ux_alerta_caixa_conta','ux_alerta_caixa_empresa');
    IF v_indices < 3 THEN
        RAISE WARNING 'unicidade do planejamento incompleta (% de 3)', v_indices;
        v_falhas := v_falhas + 1;
    END IF;

    -- As tabelas do M14 nasceram em 03, antes do bloco de RLS: a verificacao
    -- garante que continuam cobertas mesmo em bancos restaurados de outro ponto.
    SELECT count(*) INTO v_rls
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'gestao'
       AND c.relname IN ('cenario_fluxo_caixa','projecao_fluxo_caixa','alerta_caixa')
       AND c.relrowsecurity AND c.relforcerowsecurity;
    IF v_rls < 3 THEN
        RAISE WARNING 'RLS ausente em tabelas do M14 (% de 3)', v_rls; v_falhas := v_falhas + 1;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_proc
                    WHERE pronamespace = 'gestao'::regnamespace
                      AND proname = 'fn_saldo_caixa_atual') THEN
        RAISE WARNING 'saldo de caixa ausente (RF-105)'; v_falhas := v_falhas + 1;
    END IF;

    IF v_falhas = 0 THEN
        RAISE NOTICE 'M14 - Fluxo de Caixa e Planejamento: ajustes aplicados com sucesso.';
    END IF;
END $$;
