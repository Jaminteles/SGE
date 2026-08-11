-- =============================================================================
-- 06_rh_sprint3.sql
-- Sprint 3 - Fase 2 (Cadastros): M03 - Funcionarios e RH (RF-013 a RF-021).
--
-- Executar como gestao_owner, depois de 01 a 05:
--   psql -U gestao_owner -h localhost -d gestao_empresarial -f 06_rh_sprint3.sql
-- Idempotente: pode ser reexecutado.
--
-- O que 01 ja entregava: as tabelas do M03 (departamento, cargo, funcionario,
-- dado_bancario, funcionario_evento, verba, funcionario_verba, reembolso,
-- reembolso_item) e a RLS por empresa aplicada a todas elas (03). Este script
-- fecha o que faltava para os requisitos da sprint:
--   1. RN-010  - trilha de auditoria nas entidades de RH
--   2. RN-001  - referencias entre tabelas presas a mesma empresa (FK composta)
--   3. RF-014  - hierarquia de gestores e departamentos sem ciclo
--   4. RF-015/RF-020 - o historico funcional projeta a situacao do funcionario
--   5. RF-017  - uma verba nao pode ter vigencias sobrepostas para o mesmo
--                funcionario
--   6. RF-018  - valor do reembolso calculado a partir dos itens, numeracao
--                sequencial por empresa e segregacao de funcao na aprovacao
--   7. RF-019  - comprovantes: deduplicacao por hash e vinculo com o item
-- =============================================================================
SET search_path = gestao, public;

-- -----------------------------------------------------------------------------
-- 1. RN-010: auditoria das entidades de RH
--
-- 03 aplicou o trigger generico apenas nas entidades criticas conhecidas ate
-- ali; nenhuma tabela do M03 estava na lista. Salario, dado bancario e
-- aprovacao de reembolso sao exatamente o tipo de dado cuja alteracao precisa
-- de autor e valores anterior/posterior (RF-114 a RF-116).
-- -----------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'departamento','cargo','funcionario','dado_bancario','funcionario_evento',
        'verba','funcionario_verba','reembolso','reembolso_item','documento'
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
-- As FKs de 01 apontam so para o id: nada impedia um funcionario da empresa A
-- de referenciar o centro de custo da empresa B. A RLS nao cobre esse caso --
-- a verificacao de FK roda no sistema, sem politica -- entao o isolamento
-- precisa ser estrutural: chave unica (empresa_id, id) no destino e FK composta
-- (empresa_id, <coluna>) na origem. Passa a ser impossivel apontar para fora da
-- propria empresa, mesmo com um defeito na aplicacao.
--
-- Efeito colateral assumido: ON DELETE SET NULL nao existe para FK composta no
-- PostgreSQL 14 (a clausula por coluna so chegou no 15) e viraria tentativa de
-- anular empresa_id, que e NOT NULL. Onde havia SET NULL passa a valer
-- RESTRICT: cadastro em uso nao e removido, e inativado (`ativo = false`) --
-- que ja e o comportamento exposto pela API.
-- -----------------------------------------------------------------------------
-- 2.1 Chave candidata (empresa_id, id) nas tabelas referenciadas.
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'filial','centro_custo','categoria_financeira','cargo','departamento',
        'funcionario','verba','reembolso','documento'
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
            ('funcionario',      'filial_id',              'filial',               'RESTRICT'),
            ('funcionario',      'cargo_id',               'cargo',                'RESTRICT'),
            ('funcionario',      'departamento_id',        'departamento',         'RESTRICT'),
            ('funcionario',      'centro_custo_id',        'centro_custo',         'RESTRICT'),
            ('funcionario',      'gestor_id',              'funcionario',          'RESTRICT'),
            ('departamento',     'departamento_pai_id',    'departamento',         'RESTRICT'),
            ('departamento',     'centro_custo_id',        'centro_custo',         'RESTRICT'),
            ('dado_bancario',    'funcionario_id',         'funcionario',          'CASCADE'),
            ('funcionario_evento','funcionario_id',        'funcionario',          'CASCADE'),
            ('funcionario_evento','cargo_id',              'cargo',                'RESTRICT'),
            ('funcionario_evento','departamento_id',       'departamento',         'RESTRICT'),
            ('funcionario_evento','centro_custo_id',       'centro_custo',         'RESTRICT'),
            ('verba',            'categoria_financeira_id','categoria_financeira',  'RESTRICT'),
            ('funcionario_verba','funcionario_id',         'funcionario',          'CASCADE'),
            ('funcionario_verba','verba_id',               'verba',                'RESTRICT'),
            ('reembolso',        'funcionario_id',         'funcionario',          'RESTRICT'),
            ('reembolso',        'filial_id',              'filial',               'RESTRICT'),
            ('reembolso',        'centro_custo_id',        'centro_custo',         'RESTRICT'),
            ('reembolso_item',   'reembolso_id',           'reembolso',            'CASCADE'),
            ('reembolso_item',   'categoria_financeira_id','categoria_financeira',  'RESTRICT'),
            ('reembolso_item',   'centro_custo_id',        'centro_custo',         'RESTRICT'),
            ('reembolso_item',   'documento_id',           'documento',            'RESTRICT')
        ) AS t(tabela, coluna, referencia, acao)
    LOOP
        -- Remove a FK de coluna unica herdada de 01/02 (nome gerado pelo servidor).
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
-- 3. RF-014: hierarquia sem ciclo
--
-- gestor_id e departamento_pai_id sao auto-referencias. Um ciclo (A gestor de B,
-- B gestor de A) nao viola nenhuma constraint e trava qualquer consulta
-- recursiva -- inclusive a de organograma. A verificacao e a mesma para as duas
-- tabelas, entao a funcao recebe a coluna pai como argumento do trigger.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_valida_ciclo_hierarquia() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_coluna text := TG_ARGV[0];
    v_pai    uuid := (to_jsonb(NEW) ->> v_coluna)::uuid;
    v_ciclo  boolean;
BEGIN
    IF v_pai IS NULL THEN
        RETURN NEW;
    END IF;
    IF v_pai = NEW.id THEN
        RAISE EXCEPTION 'Hierarquia invalida em %: o registro nao pode ser seu proprio superior.',
            TG_TABLE_NAME;
    END IF;

    EXECUTE format($q$
        WITH RECURSIVE cadeia(id, pai) AS (
            SELECT t.id, t.%1$I FROM gestao.%2$I t WHERE t.id = $1
            UNION ALL
            SELECT t.id, t.%1$I FROM gestao.%2$I t JOIN cadeia c ON t.id = c.pai
        )
        SELECT EXISTS (SELECT 1 FROM cadeia WHERE id = $2)
    $q$, v_coluna, TG_TABLE_NAME)
    INTO v_ciclo USING v_pai, NEW.id;

    IF v_ciclo THEN
        RAISE EXCEPTION 'Hierarquia invalida em %: a alteracao cria um ciclo.', TG_TABLE_NAME;
    END IF;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_valida_ciclo_hierarquia() IS
    'RF-014 - impede ciclo em auto-referencia; recebe a coluna pai em TG_ARGV[0].';

DROP TRIGGER IF EXISTS trg_funcionario_hierarquia ON funcionario;
CREATE TRIGGER trg_funcionario_hierarquia
    BEFORE INSERT OR UPDATE OF gestor_id ON funcionario
    FOR EACH ROW EXECUTE FUNCTION fn_valida_ciclo_hierarquia('gestor_id');

DROP TRIGGER IF EXISTS trg_departamento_hierarquia ON departamento;
CREATE TRIGGER trg_departamento_hierarquia
    BEFORE INSERT OR UPDATE OF departamento_pai_id ON departamento
    FOR EACH ROW EXECUTE FUNCTION fn_valida_ciclo_hierarquia('departamento_pai_id');

-- -----------------------------------------------------------------------------
-- 4. RF-015 / RF-020: o historico funcional projeta a situacao atual
--
-- Admissao, ferias, afastamento, retorno, promocao, transferencia, alteracao
-- salarial e desligamento sao registrados em funcionario_evento. Deixar a
-- aplicacao atualizar `funcionario` em seguida abriria a porta para os dois
-- ficarem divergentes; aqui o historico e a fonte e a projecao e do banco.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_aplica_evento_funcionario() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_status enum_status_funcionario;
BEGIN
    v_status := CASE NEW.tipo
        WHEN 'ADMISSAO'     THEN 'ATIVO'
        WHEN 'RETORNO'      THEN 'ATIVO'
        WHEN 'FERIAS'       THEN 'FERIAS'
        WHEN 'AFASTAMENTO'  THEN 'AFASTADO'
        WHEN 'DESLIGAMENTO' THEN 'DESLIGADO'
        ELSE NULL
    END;

    UPDATE funcionario f
       SET status            = coalesce(v_status, f.status),
           cargo_id          = coalesce(NEW.cargo_id, f.cargo_id),
           departamento_id   = coalesce(NEW.departamento_id, f.departamento_id),
           centro_custo_id   = coalesce(NEW.centro_custo_id, f.centro_custo_id),
           salario_base      = coalesce(NEW.salario, f.salario_base),
           data_desligamento = CASE WHEN NEW.tipo = 'DESLIGAMENTO'
                                    THEN NEW.data_inicio ELSE f.data_desligamento END
     WHERE f.id = NEW.funcionario_id;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_aplica_evento_funcionario() IS
    'RF-015/RF-020 - projeta o evento do historico sobre o cadastro do funcionario.';

DROP TRIGGER IF EXISTS trg_funcionario_evento_aplica ON funcionario_evento;
CREATE TRIGGER trg_funcionario_evento_aplica
    AFTER INSERT ON funcionario_evento
    FOR EACH ROW EXECUTE FUNCTION fn_aplica_evento_funcionario();

-- Historico e registro: alterar ou apagar um evento reescreveria a situacao
-- projetada acima sem deixar rastro coerente. Correcao se faz com novo evento.
--
-- Efeito pretendido: como funcionario_evento.funcionario_id e ON DELETE CASCADE,
-- excluir um funcionario passa a falhar. E o comportamento desejado -- o
-- desligamento e por evento (RF-015), nao por DELETE, e o historico funcional
-- nao pode ser apagado junto com o cadastro.
CREATE OR REPLACE FUNCTION fn_bloqueia_alteracao_evento_rh() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Evento do historico funcional nao pode ser alterado ou removido (RF-015).';
END;
$$;

DROP TRIGGER IF EXISTS trg_funcionario_evento_imutavel ON funcionario_evento;
CREATE TRIGGER trg_funcionario_evento_imutavel
    BEFORE UPDATE OR DELETE ON funcionario_evento
    FOR EACH ROW EXECUTE FUNCTION fn_bloqueia_alteracao_evento_rh();

-- -----------------------------------------------------------------------------
-- 5. RF-017: vigencias de verba sem sobreposicao
--
-- Duas linhas ativas da mesma verba para o mesmo funcionario no mesmo periodo
-- dobrariam o valor na folha. daterange com limite superior nulo representa
-- "sem fim previsto", que e o caso da verba vigente.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.funcionario_verba'::regclass
                      AND conname = 'ex_funcionario_verba_vigencia') THEN
        ALTER TABLE funcionario_verba
            ADD CONSTRAINT ex_funcionario_verba_vigencia
            EXCLUDE USING gist (
                funcionario_id WITH =,
                verba_id       WITH =,
                daterange(vigencia_inicio, vigencia_fim, '[]') WITH &&
            );
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_funcionario_verba_vigencia
    ON funcionario_verba (empresa_id, vigencia_inicio DESC);

-- -----------------------------------------------------------------------------
-- 6. RF-018: reembolso
-- -----------------------------------------------------------------------------

-- 6.1 O valor do reembolso e a soma dos itens, nunca o que o cliente enviou.
CREATE OR REPLACE FUNCTION fn_recalcula_total_reembolso() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_reembolso uuid := coalesce(NEW.reembolso_id, OLD.reembolso_id);
BEGIN
    UPDATE reembolso r
       SET valor_total = coalesce((SELECT sum(i.valor)
                                     FROM reembolso_item i
                                    WHERE i.reembolso_id = v_reembolso), 0)
     WHERE r.id = v_reembolso;
    RETURN coalesce(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION fn_recalcula_total_reembolso() IS
    'RF-018/RN-012 - valor_total do reembolso derivado dos itens.';

DROP TRIGGER IF EXISTS trg_reembolso_item_total ON reembolso_item;
CREATE TRIGGER trg_reembolso_item_total
    AFTER INSERT OR UPDATE OR DELETE ON reembolso_item
    FOR EACH ROW EXECUTE FUNCTION fn_recalcula_total_reembolso();

-- 6.2 Itens so mudam enquanto a solicitacao esta em elaboracao ou analise.
CREATE OR REPLACE FUNCTION fn_valida_item_reembolso_editavel() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_status enum_status_reembolso;
BEGIN
    SELECT r.status INTO v_status
      FROM reembolso r
     WHERE r.id = coalesce(NEW.reembolso_id, OLD.reembolso_id);

    IF v_status IS NOT NULL AND v_status NOT IN ('RASCUNHO','SOLICITADO','EM_ANALISE') THEN
        RAISE EXCEPTION 'Reembolso % nao aceita alteracao de itens (RF-018).', v_status;
    END IF;
    RETURN coalesce(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_reembolso_item_editavel ON reembolso_item;
CREATE TRIGGER trg_reembolso_item_editavel
    BEFORE INSERT OR UPDATE OR DELETE ON reembolso_item
    FOR EACH ROW EXECUTE FUNCTION fn_valida_item_reembolso_editavel();

-- 6.3 RN-003: segregacao de funcao na aprovacao.
--
-- Quem aprova precisa estar identificado e nao pode ser o proprio solicitante --
-- a regra vale no banco, e nao so no service, porque e a garantia que sobrevive
-- a qualquer caminho de escrita.
CREATE OR REPLACE FUNCTION fn_valida_aprovacao_reembolso() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_usuario_solicitante uuid;
BEGIN
    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
        RETURN NEW;
    END IF;

    IF NEW.status IN ('APROVADO','REPROVADO') THEN
        IF NEW.aprovado_por IS NULL THEN
            RAISE EXCEPTION 'Reembolso aprovado/reprovado exige o usuario responsavel (RN-003).';
        END IF;

        SELECT f.usuario_id INTO v_usuario_solicitante
          FROM funcionario f
         WHERE f.id = NEW.funcionario_id;

        IF v_usuario_solicitante IS NOT NULL AND v_usuario_solicitante = NEW.aprovado_por THEN
            RAISE EXCEPTION 'O solicitante nao pode aprovar o proprio reembolso (RN-003).';
        END IF;

        NEW.aprovado_em := coalesce(NEW.aprovado_em, now());
    END IF;

    IF NEW.status = 'PAGO' AND OLD.status <> 'APROVADO' THEN
        RAISE EXCEPTION 'Reembolso so pode ser pago apos aprovacao (RF-018).';
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_valida_aprovacao_reembolso() IS
    'RN-003 - aprovacao de reembolso identificada e sem autoaprovacao.';

DROP TRIGGER IF EXISTS trg_reembolso_aprovacao ON reembolso;
CREATE TRIGGER trg_reembolso_aprovacao
    BEFORE UPDATE ON reembolso
    FOR EACH ROW EXECUTE FUNCTION fn_valida_aprovacao_reembolso();

-- 6.4 Numeracao sequencial por empresa e ano.
--
-- O lock de transacao serializa apenas as solicitacoes da mesma empresa; duas
-- requisicoes concorrentes nao produzem o mesmo numero (uq_reembolso_numero
-- seria a ultima barreira, ao custo de um erro para o usuario).
CREATE OR REPLACE FUNCTION fn_proximo_numero_reembolso(p_empresa_id uuid)
RETURNS varchar
LANGUAGE plpgsql AS $$
DECLARE
    v_ano       text := to_char(current_date, 'YYYY');
    v_prefixo   text := 'REEMB-' || v_ano || '-';
    v_sequencia int;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('reembolso:' || p_empresa_id::text));

    SELECT coalesce(max(substring(r.numero from '[0-9]+$')::int), 0) + 1
      INTO v_sequencia
      FROM reembolso r
     WHERE r.empresa_id = p_empresa_id
       AND r.numero LIKE v_prefixo || '%';

    RETURN v_prefixo || lpad(v_sequencia::text, 6, '0');
END;
$$;

COMMENT ON FUNCTION fn_proximo_numero_reembolso(uuid) IS
    'RF-018 - proximo numero de reembolso da empresa no ano corrente.';

CREATE INDEX IF NOT EXISTS ix_reembolso_empresa_status
    ON reembolso (empresa_id, status, data_solicitacao DESC);

-- -----------------------------------------------------------------------------
-- 7. RF-019: comprovantes
--
-- O comprovante e uma linha de `documento` com categoria COMPROVANTE apontando
-- para o item de despesa. O hash permite reconhecer o mesmo arquivo enviado
-- duas vezes -- sinal classico de despesa duplicada.
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS ix_documento_hash
    ON documento (empresa_id, hash_sha256) WHERE hash_sha256 IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_documento_storage_key
    ON documento (storage_provider, storage_key);

CREATE INDEX IF NOT EXISTS ix_funcionario_status
    ON funcionario (empresa_id, status);

-- -----------------------------------------------------------------------------
-- 8. Privilegios das funcoes chamadas pela API
-- -----------------------------------------------------------------------------
DO $$
DECLARE r text;
BEGIN
    FOREACH r IN ARRAY ARRAY['app_gestao', 'sge_api'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format(
                'GRANT EXECUTE ON FUNCTION gestao.fn_proximo_numero_reembolso(uuid) TO %I;', r);
        END IF;
    END LOOP;
END $$;

-- Reaplica o search_path fixo exigido por 04 nas funcoes criadas aqui.
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
BEGIN
    SELECT count(*) INTO v_triggers
      FROM pg_trigger
     WHERE NOT tgisinternal
       AND tgname IN ('trg_funcionario_auditoria','trg_reembolso_auditoria',
                      'trg_dado_bancario_auditoria','trg_funcionario_verba_auditoria');
    IF v_triggers < 4 THEN
        RAISE WARNING 'auditoria do M03 incompleta (% de 4)', v_triggers; v_falhas := v_falhas + 1;
    END IF;

    SELECT count(*) INTO v_fks
      FROM pg_constraint
     WHERE contype = 'f' AND conname LIKE 'fk\_%\_tenant';
    IF v_fks < 22 THEN
        RAISE WARNING 'FKs multiempresa incompletas (% de 22)', v_fks; v_falhas := v_falhas + 1;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'ex_funcionario_verba_vigencia') THEN
        RAISE WARNING 'exclusao de vigencias sobrepostas ausente (RF-017)'; v_falhas := v_falhas + 1;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_proc
                    WHERE pronamespace = 'gestao'::regnamespace
                      AND proname = 'fn_proximo_numero_reembolso') THEN
        RAISE WARNING 'numeracao de reembolso ausente (RF-018)'; v_falhas := v_falhas + 1;
    END IF;

    IF v_falhas = 0 THEN
        RAISE NOTICE 'M03 - Funcionarios e RH: ajustes aplicados com sucesso.';
    END IF;
END $$;
