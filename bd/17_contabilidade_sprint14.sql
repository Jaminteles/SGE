-- =============================================================================
-- 17_contabilidade_sprint14.sql
-- Sprint 14 - Fase 7 (Contabil/Fiscal): M11 - Contabilidade (RF-078 a RF-087).
--
-- Executar como gestao_owner, depois de 01 a 16:
--   psql -U gestao_owner -h localhost -d gestao_empresarial -f 17_contabilidade_sprint14.sql
-- Idempotente: pode ser reexecutado.
--
-- O que 03 ja entregava: as tabelas `conta_contabil`, `periodo_contabil`,
-- `lancamento_contabil` e `lancamento_partida`; as views de razao, balancete e
-- DRE; a partida dobrada por constraint trigger; o bloqueio de periodo fechado
-- (RN-008); e a recusa de partida em conta sintetica. Este script fecha o que
-- faltava para a escrituracao ser confiavel:
--   1.  RN-001 - referencias presas a mesma empresa
--   2.  RF-078 - hierarquia do plano de contas coerente
--   3.  RF-079 - natureza decorre do tipo, e nao da digitacao
--   4.  RF-081 - o cabecalho bate com a soma das partidas
--   5.  RF-081/RF-082 - lancamento imutavel e idempotencia da contabilizacao
--   6.  RF-086 - maquina de estados do periodo e coerencia das datas
--   7.  RF-087 - marca de exportacao coerente
--   8.  RN-010 - plano de contas auditado; lancamento nao se apaga
--   9.  RF-083/084/085 - views de relatorio com RLS do chamador
--   10. RN-001/RN-002 - RLS revalidada
--
-- Decisao estrutural desta sprint: **o lancamento e imutavel**. Depois de
-- gravado, nem cabecalho nem partida mudam -- corrigir e estornar e relancar. Um
-- razao em que a linha de ontem pode ser reescrita hoje nao e razao, e e sobre
-- ele que saem balancete, DRE e a obrigacao acessoria entregue ao fisco.
--
-- Segunda decisao: a contabilizacao automatica e idempotente por origem. A
-- mesma baixa nao vira dois lancamentos, e o indice parcial e o unico lugar
-- onde duas execucoes simultaneas se encontram -- sem ele, um retry dobraria a
-- despesa no resultado do mes sem nenhum erro aparente.
-- =============================================================================
SET search_path = gestao, public;

-- -----------------------------------------------------------------------------
-- 1. RN-001: referencia cruzada entre empresas
--
-- Mesma tecnica de 06 a 16: chave candidata (empresa_id, id) no destino e FK
-- composta na origem. Aqui o risco e concreto e silencioso: sem a empresa na
-- chave, a empresa A poderia lancar na conta contabil da empresa B informando o
-- id dela, e o valor apareceria no balancete de quem nao o gerou.
--
-- As quatro FKs de classificacao (categoria, verba, titulo e conta bancaria ->
-- conta_contabil) entram pelo mesmo motivo: sao elas que escolhem a conta na
-- contabilizacao automatica.
-- -----------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'conta_contabil','periodo_contabil','lancamento_contabil','centro_custo','filial'
    ] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_constraint
                        WHERE conrelid = format('gestao.%I', t)::regclass
                          AND conname  = format('uq_%s_tenant', t)) THEN
            EXECUTE format(
                'ALTER TABLE gestao.%1$I ADD CONSTRAINT uq_%1$s_tenant UNIQUE (empresa_id, id);', t);
        END IF;
    END LOOP;
END $$;

DO $$
DECLARE
    r record;
    c record;
BEGIN
    FOR r IN
        SELECT * FROM (VALUES
            ('conta_contabil',       'conta_pai_id',           'conta_contabil',      'RESTRICT'),
            ('lancamento_contabil',  'periodo_contabil_id',    'periodo_contabil',    'RESTRICT'),
            ('lancamento_contabil',  'filial_id',              'filial',              'RESTRICT'),
            ('lancamento_contabil',  'estorno_de_id',          'lancamento_contabil', 'RESTRICT'),
            ('lancamento_partida',   'lancamento_contabil_id', 'lancamento_contabil', 'CASCADE'),
            ('lancamento_partida',   'conta_contabil_id',      'conta_contabil',      'RESTRICT'),
            ('lancamento_partida',   'centro_custo_id',        'centro_custo',        'RESTRICT'),
            ('categoria_financeira', 'conta_contabil_id',      'conta_contabil',      'RESTRICT'),
            ('verba',                'conta_contabil_id',      'conta_contabil',      'RESTRICT'),
            ('titulo',               'conta_contabil_id',      'conta_contabil',      'RESTRICT'),
            ('conta_bancaria',       'conta_contabil_id',      'conta_contabil',      'RESTRICT')
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
                 FOREIGN KEY (empresa_id, %2$I) REFERENCES gestao.%3$I (empresa_id, id)
                 ON DELETE %4$s;', r.tabela, r.coluna, r.referencia, r.acao);
        END IF;
    END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 2. RF-078: hierarquia do plano de contas
--
-- Tres regras, e cada uma evita um saldo errado sem lancamento errado:
--
--  a) conta com filho nao aceita lancamento. Se aceitasse, o saldo dela seria
--     somado duas vezes no balancete -- nela e no grupo que ela representa;
--  b) o nivel decorre do pai. Nivel digitado a mao desalinha a indentacao do
--     balancete e a totalizacao por grau;
--  c) o filho herda o tipo do pai. Uma conta de RECEITA pendurada em ATIVO
--     apareceria no balanco patrimonial e sumiria da DRE.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_valida_conta_contabil() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_pai_tipo   enum_tipo_conta_contabil;
    v_pai_nivel  smallint;
    v_pai_aceita boolean;
    v_pai_empresa uuid;
BEGIN
    IF NEW.conta_pai_id IS NOT NULL THEN
        IF NEW.conta_pai_id = NEW.id THEN
            RAISE EXCEPTION 'RF-078: uma conta nao pode ser pai dela mesma'
                USING ERRCODE = 'check_violation';
        END IF;

        SELECT p.tipo, p.nivel, p.aceita_lancamento, p.empresa_id
          INTO v_pai_tipo, v_pai_nivel, v_pai_aceita, v_pai_empresa
          FROM gestao.conta_contabil p
         WHERE p.id = NEW.conta_pai_id;

        IF v_pai_empresa IS DISTINCT FROM NEW.empresa_id THEN
            RAISE EXCEPTION 'RN-001: conta pai de outra empresa'
                USING ERRCODE = 'check_violation';
        END IF;
        IF v_pai_tipo IS DISTINCT FROM NEW.tipo THEN
            RAISE EXCEPTION 'RF-079: a conta % nao pode ter tipo % sob um pai %',
                NEW.codigo, NEW.tipo, v_pai_tipo USING ERRCODE = 'check_violation';
        END IF;
        IF v_pai_aceita THEN
            RAISE EXCEPTION 'RF-078: a conta pai % aceita lancamento e nao pode ter filhas',
                NEW.conta_pai_id USING ERRCODE = 'check_violation';
        END IF;

        NEW.nivel := v_pai_nivel + 1;
    ELSE
        NEW.nivel := 1;
    END IF;

    IF NEW.aceita_lancamento AND EXISTS (
        SELECT 1 FROM gestao.conta_contabil f WHERE f.conta_pai_id = NEW.id
    ) THEN
        RAISE EXCEPTION 'RF-078: conta sintetica (com filhas) nao aceita lancamento'
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_valida_conta_contabil() IS
    'RF-078/RF-079 - hierarquia, nivel e tipo do plano de contas.';

DROP TRIGGER IF EXISTS trg_valida_conta_contabil ON conta_contabil;
CREATE TRIGGER trg_valida_conta_contabil
    BEFORE INSERT OR UPDATE ON conta_contabil
    FOR EACH ROW EXECUTE FUNCTION fn_valida_conta_contabil();

-- -----------------------------------------------------------------------------
-- 3. RF-079: a natureza decorre do tipo
--
-- Natureza e campo derivado, nao opiniao. Ativo, despesa e custo sao devedores;
-- passivo, patrimonio liquido e receita, credores. Conta de compensacao aceita
-- as duas, porque existe justamente aos pares.
--
-- Uma conta com natureza trocada nao produz erro nenhum na escrituracao: ela
-- inverte o sinal do saldo no balancete e na DRE, e o numero errado passa por
-- correto ate alguem conferir a mao.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.conta_contabil'::regclass
                      AND conname = 'ck_conta_contabil_natureza') THEN
        ALTER TABLE conta_contabil ADD CONSTRAINT ck_conta_contabil_natureza
            CHECK (
                tipo = 'COMPENSACAO'
                OR (tipo IN ('ATIVO','DESPESA','CUSTO')            AND natureza = 'DEVEDORA')
                OR (tipo IN ('PASSIVO','PATRIMONIO_LIQUIDO','RECEITA') AND natureza = 'CREDORA')
            );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.conta_contabil'::regclass
                      AND conname = 'ck_conta_contabil_codigo') THEN
        ALTER TABLE conta_contabil ADD CONSTRAINT ck_conta_contabil_codigo
            CHECK (codigo ~ '^[0-9]+(\.[0-9]+)*$');
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 4. RF-081: o cabecalho bate com a soma das partidas
--
-- A partida dobrada (03) garante debito = credito. Nao garante que
-- `valor_total` seja esse valor -- e e `valor_total` que aparece na lista de
-- lancamentos e nos totais de lote. Um cabecalho de R$ 1.000 sobre partidas de
-- R$ 100 e um lancamento que so mente onde ninguem confere.
--
-- Constraint trigger DEFERRABLE, como a de 03: o cabecalho e gravado antes das
-- partidas, e a checagem so faz sentido no fim da transacao.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_valida_total_lancamento() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_lanc    uuid := coalesce(NEW.id, OLD.id);
    v_debito  dom_valor;
    v_total   dom_valor;
BEGIN
    SELECT coalesce(sum(valor) FILTER (WHERE tipo = 'DEBITO'), 0)
      INTO v_debito
      FROM gestao.lancamento_partida
     WHERE lancamento_contabil_id = v_lanc;

    SELECT valor_total INTO v_total
      FROM gestao.lancamento_contabil WHERE id = v_lanc;

    IF v_total IS NULL THEN
        RETURN NULL;   -- lancamento removido na mesma transacao
    END IF;

    IF v_debito = 0 THEN
        RAISE EXCEPTION 'RF-081: lancamento % sem partidas', v_lanc
            USING ERRCODE = 'check_violation';
    END IF;

    IF v_debito <> v_total THEN
        RAISE EXCEPTION 'RF-081: cabecalho do lancamento % (%) nao bate com as partidas (%)',
            v_lanc, v_total, v_debito USING ERRCODE = 'check_violation';
    END IF;

    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION fn_valida_total_lancamento() IS
    'RF-081 - valor_total do cabecalho = soma dos debitos das partidas.';

DROP TRIGGER IF EXISTS trg_total_lancamento ON lancamento_contabil;
CREATE CONSTRAINT TRIGGER trg_total_lancamento
    AFTER INSERT OR UPDATE ON lancamento_contabil
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION fn_valida_total_lancamento();

-- -----------------------------------------------------------------------------
-- 5. RF-081/RF-082: lancamento imutavel e contabilizacao idempotente
--
-- 5.1 Imutabilidade. O que pode mudar depois de gravado e apenas: a marca de
-- estorno, a marca de exportacao e o vinculo com o periodo (que o proprio banco
-- resolve). Valor, historico, competencia, origem e partidas nao mudam -- o
-- caminho de correcao e o estorno, que deixa as duas versoes visiveis no razao.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_lancamento_imutavel() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'RF-082: lancamento contabil nao se apaga; estorne-o'
            USING ERRCODE = 'restrict_violation';
    END IF;

    IF NEW.valor_total     IS DISTINCT FROM OLD.valor_total
       OR NEW.historico       IS DISTINCT FROM OLD.historico
       OR NEW.data_lancamento IS DISTINCT FROM OLD.data_lancamento
       OR NEW.data_competencia IS DISTINCT FROM OLD.data_competencia
       OR NEW.origem_tipo    IS DISTINCT FROM OLD.origem_tipo
       OR NEW.origem_id      IS DISTINCT FROM OLD.origem_id
       OR NEW.estorno_de_id  IS DISTINCT FROM OLD.estorno_de_id
       OR NEW.criado_em      IS DISTINCT FROM OLD.criado_em THEN
        RAISE EXCEPTION 'RF-082: o lancamento e imutavel; corrija por estorno'
            USING ERRCODE = 'restrict_violation';
    END IF;

    IF OLD.estornado AND NOT NEW.estornado THEN
        RAISE EXCEPTION 'RF-082: estorno nao se desfaz'
            USING ERRCODE = 'restrict_violation';
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_lancamento_imutavel() IS
    'RF-082 - lancamento contabil nao se altera nem se apaga; correcao e estorno.';

DROP TRIGGER IF EXISTS trg_lancamento_imutavel ON lancamento_contabil;
CREATE TRIGGER trg_lancamento_imutavel
    BEFORE UPDATE OR DELETE ON lancamento_contabil
    FOR EACH ROW EXECUTE FUNCTION fn_lancamento_imutavel();

CREATE OR REPLACE FUNCTION fn_partida_imutavel() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_existe boolean;
BEGIN
    -- O CASCADE do estorno de um lancamento removido na mesma transacao nao
    -- passa por aqui: DELETE do cabecalho ja e recusado acima.
    IF TG_OP = 'DELETE' THEN
        SELECT true INTO v_existe FROM gestao.lancamento_contabil
         WHERE id = OLD.lancamento_contabil_id;
        IF v_existe THEN
            RAISE EXCEPTION 'RF-082: partida de lancamento gravado nao se remove'
                USING ERRCODE = 'restrict_violation';
        END IF;
        RETURN OLD;
    END IF;

    RAISE EXCEPTION 'RF-082: partida de lancamento gravado nao se altera'
        USING ERRCODE = 'restrict_violation';
END;
$$;

COMMENT ON FUNCTION fn_partida_imutavel() IS
    'RF-082 - a partida so existe no INSERT do lancamento; depois e imutavel.';

DROP TRIGGER IF EXISTS trg_partida_imutavel ON lancamento_partida;
CREATE TRIGGER trg_partida_imutavel
    BEFORE UPDATE OR DELETE ON lancamento_partida
    FOR EACH ROW EXECUTE FUNCTION fn_partida_imutavel();

-- 5.2 Idempotencia da contabilizacao automatica.
--
-- Uma baixa, um documento fiscal ou um movimento de estoque produzem UM
-- lancamento. Retry da fila, duplo clique e reprocessamento batem no indice.
-- `MANUAL` e `ESTORNO` ficam de fora: o lancamento manual repetido e decisao de
-- quem lanca, e o estorno se identifica por `estorno_de_id`.
CREATE UNIQUE INDEX IF NOT EXISTS ux_lancamento_origem
    ON lancamento_contabil (empresa_id, origem_tipo, origem_id)
    WHERE origem_tipo IS NOT NULL
      AND origem_tipo NOT IN ('MANUAL','ESTORNO')
      AND origem_id IS NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.lancamento_contabil'::regclass
                      AND conname = 'ck_lancamento_origem') THEN
        ALTER TABLE lancamento_contabil ADD CONSTRAINT ck_lancamento_origem
            CHECK (origem_tipo IS NULL OR origem_tipo IN
                ('MANUAL','TITULO_BAIXA','DOCUMENTO_FISCAL','ESTOQUE','ESTORNO'));
    END IF;

    -- RF-082: o estorno aponta para o que estornou, e so ele usa esse tipo.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.lancamento_contabil'::regclass
                      AND conname = 'ck_lancamento_estorno') THEN
        ALTER TABLE lancamento_contabil ADD CONSTRAINT ck_lancamento_estorno
            CHECK ((origem_tipo = 'ESTORNO') = (estorno_de_id IS NOT NULL));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.lancamento_contabil'::regclass
                      AND conname = 'ck_lancamento_historico') THEN
        ALTER TABLE lancamento_contabil ADD CONSTRAINT ck_lancamento_historico
            CHECK (btrim(historico) <> '');
    END IF;
END $$;

-- Um lancamento e estornado uma vez so: sem isto, dois estornos do mesmo
-- lancamento zerariam o valor e ainda inverteriam o sinal dele.
CREATE UNIQUE INDEX IF NOT EXISTS ux_lancamento_estorno_unico
    ON lancamento_contabil (estorno_de_id)
    WHERE estorno_de_id IS NOT NULL;

-- O periodo do lancamento e resolvido pelo banco a partir da competencia: se a
-- aplicacao o escolhesse, um lancamento poderia apontar para um periodo que nao
-- contem a propria data de competencia -- e o balancete do mes seguinte
-- carregaria um valor do mes anterior sem que nada parecesse errado.
CREATE OR REPLACE FUNCTION fn_lancamento_define_periodo() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_periodo uuid;
BEGIN
    SELECT p.id INTO v_periodo
      FROM gestao.periodo_contabil p
     WHERE p.empresa_id = NEW.empresa_id
       AND NEW.data_competencia BETWEEN p.data_inicio AND p.data_fim;

    IF v_periodo IS NULL THEN
        RAISE EXCEPTION 'RF-086: nao ha periodo contabil aberto para a competencia %',
            NEW.data_competencia USING ERRCODE = 'check_violation';
    END IF;

    NEW.periodo_contabil_id := v_periodo;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_lancamento_define_periodo() IS
    'RF-086 - o periodo do lancamento decorre da competencia, nao da aplicacao.';

DROP TRIGGER IF EXISTS trg_lancamento_periodo ON lancamento_contabil;
CREATE TRIGGER trg_lancamento_periodo
    BEFORE INSERT ON lancamento_contabil
    FOR EACH ROW EXECUTE FUNCTION fn_lancamento_define_periodo();

CREATE INDEX IF NOT EXISTS ix_lancamento_periodo
    ON lancamento_contabil (empresa_id, periodo_contabil_id);

CREATE INDEX IF NOT EXISTS ix_partida_conta_empresa
    ON lancamento_partida (empresa_id, conta_contabil_id);

-- -----------------------------------------------------------------------------
-- 6. RF-086: periodo contabil
--
-- 6.1 As datas descrevem o mes que o periodo diz ser. Sem isto, um periodo
-- "2026/03" poderia cobrir abril inteiro, e a unica (empresa, exercicio, mes)
-- deixaria de impedir sobreposicao -- que e o que ela existe para impedir.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.periodo_contabil'::regclass
                      AND conname = 'ck_periodo_competencia') THEN
        ALTER TABLE periodo_contabil ADD CONSTRAINT ck_periodo_competencia
            CHECK (
                data_inicio = make_date(exercicio, mes, 1)
                AND data_fim = (make_date(exercicio, mes, 1) + interval '1 month - 1 day')::date
            );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.periodo_contabil'::regclass
                      AND conname = 'ck_periodo_exercicio') THEN
        ALTER TABLE periodo_contabil ADD CONSTRAINT ck_periodo_exercicio
            CHECK (exercicio BETWEEN 1900 AND 2999);
    END IF;
END $$;

-- 6.2 Maquina de estados:
--
--   ABERTO        -> EM_FECHAMENTO | FECHADO
--   EM_FECHAMENTO -> FECHADO | ABERTO
--   FECHADO       -> REABERTO   (exige motivo)
--   REABERTO      -> EM_FECHAMENTO | FECHADO
--
-- Reabrir sem motivo e a alteracao que ninguem consegue explicar depois: o mes
-- ja foi entregue ao contador, e alguem voltou a mexer nele.
CREATE OR REPLACE FUNCTION fn_periodo_transicao() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
        RETURN NEW;
    END IF;

    IF NOT (
        (OLD.status = 'ABERTO'        AND NEW.status IN ('EM_FECHAMENTO','FECHADO')) OR
        (OLD.status = 'EM_FECHAMENTO' AND NEW.status IN ('FECHADO','ABERTO'))        OR
        (OLD.status = 'FECHADO'       AND NEW.status = 'REABERTO')                   OR
        (OLD.status = 'REABERTO'      AND NEW.status IN ('EM_FECHAMENTO','FECHADO'))
    ) THEN
        RAISE EXCEPTION 'RF-086: transicao invalida de % para %', OLD.status, NEW.status
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.status = 'FECHADO' THEN
        NEW.fechado_em := now();
        IF NEW.fechado_por IS NULL THEN
            RAISE EXCEPTION 'RN-010: fechamento de periodo exige o responsavel'
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    IF NEW.status = 'REABERTO' THEN
        IF NEW.motivo_reabertura IS NULL OR btrim(NEW.motivo_reabertura) = '' THEN
            RAISE EXCEPTION 'RF-086: a reabertura de periodo exige motivo'
                USING ERRCODE = 'check_violation';
        END IF;
        IF NEW.reaberto_por IS NULL THEN
            RAISE EXCEPTION 'RN-010: reabertura de periodo exige o responsavel'
                USING ERRCODE = 'check_violation';
        END IF;
        NEW.reaberto_em := now();
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_periodo_transicao() IS
    'RF-086 - maquina de estados do periodo contabil; reabertura exige motivo e responsavel.';

DROP TRIGGER IF EXISTS trg_periodo_transicao ON periodo_contabil;
CREATE TRIGGER trg_periodo_transicao
    BEFORE UPDATE ON periodo_contabil
    FOR EACH ROW EXECUTE FUNCTION fn_periodo_transicao();

-- O periodo nao se apaga: apagar um mes fechado levaria junto o registro de que
-- ele esteve fechado, e os lancamentos ficariam sem competencia declarada.
CREATE OR REPLACE FUNCTION fn_periodo_sem_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'RF-086: periodo contabil nao se apaga'
        USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_periodo_sem_delete ON periodo_contabil;
CREATE TRIGGER trg_periodo_sem_delete
    BEFORE DELETE ON periodo_contabil
    FOR EACH ROW EXECUTE FUNCTION fn_periodo_sem_delete();

-- -----------------------------------------------------------------------------
-- 7. RF-087: marca de exportacao coerente
--
-- Exportado sem data (ou o contrario) transforma "ja mandei para o contador"
-- numa afirmacao sem quando -- e a pergunta seguinte, sempre, e "mandou quando?".
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.lancamento_contabil'::regclass
                      AND conname = 'ck_lancamento_exportado') THEN
        ALTER TABLE lancamento_contabil ADD CONSTRAINT ck_lancamento_exportado
            CHECK (exportado = (exportado_em IS NOT NULL));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_lancamento_nao_exportado
    ON lancamento_contabil (empresa_id, data_competencia)
    WHERE NOT exportado;

-- -----------------------------------------------------------------------------
-- 8. RN-010: o plano de contas e auditado
--
-- `lancamento_contabil` e `periodo_contabil` ja entram na lista de 03. Faltava a
-- conta: mudar o tipo de uma conta, inativa-la ou reapontar o pai muda o
-- balancete inteiro retroativamente, sem tocar em um lancamento sequer.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
                    WHERE tgrelid = 'gestao.conta_contabil'::regclass
                      AND tgname = 'trg_conta_contabil_auditoria') THEN
        CREATE TRIGGER trg_conta_contabil_auditoria
            AFTER INSERT OR UPDATE OR DELETE ON gestao.conta_contabil
            FOR EACH ROW EXECUTE FUNCTION gestao.fn_auditoria_generica();
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 9. RF-083/RF-084/RF-085: views de relatorio corrigidas e com a RLS de quem chama
--
-- 9.1 CORRECAO. `vw_razao_contabil` (03) filtrava `WHERE NOT lc.estornado`, o
-- que exclui o lancamento estornado e MANTEM o estorno dele. O par que deveria
-- se anular vira, assim, um valor negativo sozinho no razao -- e o balancete e a
-- DRE, que derivam desta view, herdavam o erro.
--
-- O correto e manter os dois: o lancamento original e o estorno somam zero, e a
-- trilha de RF-082 continua visivel (a pergunta "o que estava errado e o que
-- ficou no lugar" so tem resposta se as duas linhas aparecerem). A coluna
-- `estornado` fica exposta para quem quiser filtrar por conta propria.
--

-- As views de 03 pertencem ao owner do schema. Ate o PostgreSQL 14 elas rodam
-- com os privilegios do owner, e a RLS aplicada e a do owner -- que aqui ainda
-- filtra por `fn_empresa_corrente()`, entao o isolamento se mantem. A partir do
-- 15 existe `security_invoker`, que torna isso explicito em vez de acidental: a
-- politica avaliada passa a ser a do papel que consulta.
--
-- A API nao le estas views (os relatorios sao agregados pelo Prisma, com o
-- filtro de empresa explicito alem da RLS). Elas existem para consulta direta
-- ao banco -- e e justamente ai que o isolamento precisa valer sem depender de
-- quem executou.
-- -----------------------------------------------------------------------------
-- As tres sao recriadas juntas: `CREATE OR REPLACE VIEW` nao aceita mudanca na
-- lista de colunas, e o balancete e a DRE derivam do razao.
DROP VIEW IF EXISTS vw_dre;
DROP VIEW IF EXISTS vw_balancete;
DROP VIEW IF EXISTS vw_razao_contabil;

CREATE VIEW vw_razao_contabil AS
SELECT lp.empresa_id,
       cc.id                AS conta_contabil_id,
       cc.codigo            AS conta_codigo,
       cc.nome              AS conta_nome,
       cc.natureza          AS conta_natureza,
       lc.data_competencia,
       lc.numero            AS lancamento_numero,
       lc.historico,
       lp.tipo,
       CASE WHEN lp.tipo = 'DEBITO'  THEN lp.valor ELSE 0 END AS valor_debito,
       CASE WHEN lp.tipo = 'CREDITO' THEN lp.valor ELSE 0 END AS valor_credito,
       lp.centro_custo_id,
       lc.origem_tipo,
       lc.origem_id,
       lc.estornado,
       lc.estorno_de_id
FROM lancamento_partida lp
JOIN lancamento_contabil lc ON lc.id = lp.lancamento_contabil_id
JOIN conta_contabil cc      ON cc.id = lp.conta_contabil_id;

COMMENT ON VIEW vw_razao_contabil IS
    'RF-083 - razao contabil. Inclui lancamentos estornados E seus estornos: o par soma zero, '
    'e excluir so o estornado deixaria o estorno sozinho, produzindo saldo negativo fantasma.';

-- Balancete: o saldo respeita a natureza da conta. Sem isso todo passivo e toda
-- receita apareceriam negativos, e o relatorio pareceria errado estando certo.
CREATE VIEW vw_balancete AS
SELECT r.empresa_id,
       r.conta_contabil_id,
       r.conta_codigo,
       r.conta_nome,
       r.conta_natureza,
       date_trunc('month', r.data_competencia)::date AS competencia,
       sum(r.valor_debito)  AS total_debito,
       sum(r.valor_credito) AS total_credito,
       CASE WHEN r.conta_natureza = 'DEVEDORA'
            THEN sum(r.valor_debito) - sum(r.valor_credito)
            ELSE sum(r.valor_credito) - sum(r.valor_debito) END AS saldo
FROM vw_razao_contabil r
GROUP BY r.empresa_id, r.conta_contabil_id, r.conta_codigo, r.conta_nome, r.conta_natureza,
         date_trunc('month', r.data_competencia);

COMMENT ON VIEW vw_balancete IS
    'RF-084 - balancete por competencia mensal. O saldo segue a natureza da conta.';

-- DRE: o saldo do balancete ja vem na natureza da conta, entao receita, custo e
-- despesa usam o mesmo numero -- receita positiva por credito, custo e despesa
-- positivos por debito.
CREATE VIEW vw_dre AS
SELECT b.empresa_id,
       b.competencia,
       cc.tipo,
       cc.codigo,
       cc.nome,
       b.saldo AS valor
FROM vw_balancete b
JOIN conta_contabil cc ON cc.id = b.conta_contabil_id
WHERE cc.tipo IN ('RECEITA','DESPESA','CUSTO');

COMMENT ON VIEW vw_dre IS
    'RF-085 - contas de resultado por competencia, ja com o sinal da natureza.';

-- 9.2 RLS das views.
DO $$
BEGIN
    IF current_setting('server_version_num')::int >= 150000 THEN
        EXECUTE 'ALTER VIEW gestao.vw_razao_contabil SET (security_invoker = true)';
        EXECUTE 'ALTER VIEW gestao.vw_balancete      SET (security_invoker = true)';
        EXECUTE 'ALTER VIEW gestao.vw_dre            SET (security_invoker = true)';
    ELSE
        RAISE NOTICE 'PostgreSQL < 15: views contabeis seguem com RLS do owner (isolamento mantido).';
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 10. RN-001 / RN-002: RLS revalidada
--
-- As quatro tabelas ganharam restricoes e triggers neste script. A politica
-- generica de 03 continua correta (empresa_id NOT NULL), mas recria-la aqui
-- garante que uma reexecucao parcial de 03, ou uma tabela restaurada de backup,
-- nao a deixe sem politica -- e sem politica, com FORCE RLS, a tabela nao
-- responde, o que aparece como "bug de consulta" em vez de falha de isolamento.
-- -----------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'conta_contabil','periodo_contabil','lancamento_contabil','lancamento_partida'
    ] LOOP
        EXECUTE format('ALTER TABLE gestao.%I ENABLE ROW LEVEL SECURITY;', t);
        EXECUTE format('ALTER TABLE gestao.%I FORCE ROW LEVEL SECURITY;', t);
        EXECUTE format('DROP POLICY IF EXISTS pol_%1$s_tenant ON gestao.%1$I;', t);
        EXECUTE format(
            'CREATE POLICY pol_%1$s_tenant ON gestao.%1$I
             USING (empresa_id = gestao.fn_empresa_corrente())
             WITH CHECK (empresa_id = gestao.fn_empresa_corrente());', t);
    END LOOP;
END $$;

-- =============================================================================
-- FIM - 17_contabilidade_sprint14.sql
-- =============================================================================
