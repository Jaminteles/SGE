-- =============================================================================
-- 14_conciliacao_sprint11.sql
-- Sprint 11 - Fase 5 (Bancario): M10 - Conciliacao Bancaria (RF-071 a RF-077).
--
-- Executar como gestao_owner, depois de 01 a 13:
--   psql -U gestao_owner -h localhost -d gestao_empresarial -f 14_conciliacao_sprint11.sql
-- Idempotente: pode ser reexecutado.
--
-- O que 02 ja entregava: as tabelas `regra_conciliacao` e `conciliacao`, a RLS
-- por empresa (03) e a auditoria de `conciliacao` (03). Este script fecha o que
-- faltava para o vinculo ser confiavel:
--   1.  RN-001 - referencias presas a mesma empresa (FK composta)
--   2.  RN-010 - auditoria da regra, que decide conciliacao automatica
--   3.  RF-075 - regra: prioridade, tolerancias e forma dos criterios
--   4.  RF-071 - o extrato aceita os formatos suportados de fato
--   5.  RF-074/RF-076 - conciliacao: colunas do desfazimento, imutabilidade,
--                soma que nao passa do movimento e coerencia de sentido
--   6.  RF-072/RF-076 - status do movimento derivado das conciliacoes vivas
--   7.  RF-077 - historico: a conciliacao nao se apaga
--   8.  RN-001/RN-002 - RLS revalidada nas duas tabelas alteradas
--
-- Decisao estrutural desta sprint: **conciliar nao movimenta dinheiro**. A
-- conciliacao afirma que a linha do extrato corresponde a um lancamento que ja
-- existe -- ela nao cria baixa, nao altera saldo de parcela e nao toca em
-- `conta_bancaria.saldo_atual`. Quem paga e o M09; quem baixa e o M08. Se a
-- conciliacao tambem liquidasse, o mesmo dinheiro teria duas portas de entrada
-- e a divergencia que ela existe para revelar (RF-076) seria produzida por ela
-- mesma.
--
-- Segunda decisao: a soma das conciliacoes vivas de um movimento e limitada
-- pelo valor do movimento, verificada com o movimento travado (FOR UPDATE).
-- Um credito de R$ 3.000 pode quitar tres parcelas de R$ 1.000; a quarta nao
-- entra -- nem em duas sessoes simultaneas.
-- =============================================================================
SET search_path = gestao, public;

-- -----------------------------------------------------------------------------
-- 1. RN-001: referencia cruzada entre empresas
--
-- Mesma tecnica de 06 a 13: chave candidata (empresa_id, id) no destino e FK
-- composta (empresa_id, <coluna>) na origem. A verificacao de FK roda no
-- sistema, sem RLS -- sem a coluna de empresa na chave, a empresa A poderia
-- conciliar o proprio extrato contra a parcela da empresa B informando o id
-- dela, e a resposta 201 confirmaria a existencia daquele id.
-- -----------------------------------------------------------------------------
-- 1.1 Chave candidata (empresa_id, id) nas tabelas referenciadas aqui.
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'titulo_parcela','titulo_baixa','transacao_pagamento',
        'transacao_bancaria','regra_conciliacao'
    ] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_constraint
                        WHERE conrelid = format('gestao.%I', t)::regclass
                          AND conname  = format('uq_%s_tenant', t)) THEN
            EXECUTE format(
                'ALTER TABLE gestao.%1$I ADD CONSTRAINT uq_%1$s_tenant UNIQUE (empresa_id, id);', t);
        END IF;
    END LOOP;
END $$;

-- 1.2 Troca das FKs de coluna unica por FKs compostas com empresa_id.
--
-- Como nas sprints anteriores, `ON DELETE SET NULL` vira `RESTRICT`: o
-- PostgreSQL 14 nao aceita SET NULL em FK composta. `transacao_bancaria_id`
-- mantem CASCADE: se o movimento sumir com a conta, o vinculo nao tem sobre o
-- que falar.
DO $$
DECLARE
    r record;
    c record;
BEGIN
    FOR r IN
        SELECT * FROM (VALUES
            ('conciliacao', 'transacao_bancaria_id',  'transacao_bancaria',  'CASCADE'),
            ('conciliacao', 'titulo_parcela_id',      'titulo_parcela',      'RESTRICT'),
            ('conciliacao', 'titulo_baixa_id',        'titulo_baixa',        'RESTRICT'),
            ('conciliacao', 'transacao_pagamento_id', 'transacao_pagamento', 'RESTRICT'),
            ('conciliacao', 'regra_conciliacao_id',   'regra_conciliacao',   'RESTRICT')
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
-- 2. RN-010: auditoria da regra
--
-- `conciliacao` ja e auditada desde 03. `regra_conciliacao` nao era, e ela e a
-- peca que concilia sozinha: quem afrouxa uma tolerancia muda o que o sistema
-- aceita como correspondencia sem tocar em nenhuma conciliacao.
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_regra_conciliacao_auditoria ON regra_conciliacao;
CREATE TRIGGER trg_regra_conciliacao_auditoria
    AFTER INSERT OR UPDATE OR DELETE ON regra_conciliacao
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria_generica();

-- -----------------------------------------------------------------------------
-- 3. RF-075: a regra de conciliacao automatica
--
-- Tolerancia sem teto e conciliacao automatica sem criterio: 60 dias e o limite
-- porque acima disso a "correspondencia" passa a alcancar a parcela do mes
-- seguinte com o mesmo valor -- exatamente o erro que a conciliacao existe para
-- nao cometer.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.regra_conciliacao'::regclass
                      AND conname = 'ck_regra_conciliacao_prioridade') THEN
        ALTER TABLE gestao.regra_conciliacao ADD CONSTRAINT ck_regra_conciliacao_prioridade
            CHECK (prioridade BETWEEN 1 AND 1000);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.regra_conciliacao'::regclass
                      AND conname = 'ck_regra_conciliacao_tolerancia') THEN
        ALTER TABLE gestao.regra_conciliacao ADD CONSTRAINT ck_regra_conciliacao_tolerancia
            CHECK (tolerancia_valor >= 0 AND tolerancia_dias BETWEEN 0 AND 60);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.regra_conciliacao'::regclass
                      AND conname = 'ck_regra_conciliacao_json') THEN
        ALTER TABLE gestao.regra_conciliacao ADD CONSTRAINT ck_regra_conciliacao_json
            CHECK (jsonb_typeof(condicoes) = 'object'
               AND jsonb_typeof(acoes)     = 'object'
               AND condicoes <> '{}'::jsonb);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.regra_conciliacao'::regclass
                      AND conname = 'uq_regra_conciliacao_nome') THEN
        ALTER TABLE gestao.regra_conciliacao ADD CONSTRAINT uq_regra_conciliacao_nome
            UNIQUE (empresa_id, nome);
    END IF;
END $$;

-- A ordem de avaliacao e determinista: prioridade, e o nome para desempatar.
-- Duas regras com a mesma prioridade nao podem conciliar de forma diferente
-- conforme a ordem em que o planejador devolveu as linhas.
CREATE INDEX IF NOT EXISTS ix_regra_conciliacao_ordem
    ON regra_conciliacao (empresa_id, prioridade, nome)
    WHERE ativo;

COMMENT ON TABLE regra_conciliacao IS
    'RF-075 - criterios de conciliacao automatica, avaliados por prioridade crescente.';

-- -----------------------------------------------------------------------------
-- 4. RF-071: formatos de extrato suportados
--
-- 13 §9 ja restringia `formato` a OFX/CSV/CNAB240/API. O comentario aqui e o
-- que documenta a lista para quem le a tabela -- o parser CNAB240 entra nesta
-- sprint e o valor ja era aceito.
-- -----------------------------------------------------------------------------
COMMENT ON COLUMN extrato_importacao.formato IS
    'RF-071 - OFX, CSV, CNAB240 (segmento E do retorno) ou API (coleta pelo provedor).';

-- -----------------------------------------------------------------------------
-- 5. RF-074 / RF-076: o vinculo
--
-- Colunas do desfazimento (RF-077): desfazer e um evento com autor e motivo,
-- nao a ausencia de uma linha.
-- -----------------------------------------------------------------------------
ALTER TABLE conciliacao ADD COLUMN IF NOT EXISTS desfeita_por uuid REFERENCES usuario(id) ON DELETE SET NULL;
ALTER TABLE conciliacao ADD COLUMN IF NOT EXISTS motivo_desfazimento text;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.conciliacao'::regclass
                      AND conname = 'ck_conciliacao_valor') THEN
        ALTER TABLE gestao.conciliacao ADD CONSTRAINT ck_conciliacao_valor
            CHECK (valor_conciliado > 0);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.conciliacao'::regclass
                      AND conname = 'ck_conciliacao_score') THEN
        ALTER TABLE gestao.conciliacao ADD CONSTRAINT ck_conciliacao_score
            CHECK (score IS NULL OR score BETWEEN 0 AND 100);
    END IF;
    -- Um vinculo precisa ter contra o que vincular. Sem isto a tabela aceitaria
    -- uma conciliacao que nao concilia nada -- e o movimento sairia de
    -- NAO_CONCILIADO sem ter par.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.conciliacao'::regclass
                      AND conname = 'ck_conciliacao_alvo') THEN
        ALTER TABLE gestao.conciliacao ADD CONSTRAINT ck_conciliacao_alvo
            CHECK (titulo_parcela_id IS NOT NULL
                OR titulo_baixa_id IS NOT NULL
                OR transacao_pagamento_id IS NOT NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.conciliacao'::regclass
                      AND conname = 'ck_conciliacao_confirmacao') THEN
        ALTER TABLE gestao.conciliacao ADD CONSTRAINT ck_conciliacao_confirmacao
            CHECK ((confirmada = false AND confirmada_em IS NULL)
                OR (confirmada = true  AND confirmada_em IS NOT NULL));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.conciliacao'::regclass
                      AND conname = 'ck_conciliacao_divergencia') THEN
        ALTER TABLE gestao.conciliacao ADD CONSTRAINT ck_conciliacao_divergencia
            CHECK (possui_divergencia = (diferenca <> 0));
    END IF;
END $$;

-- A mesma parcela nao e conciliada duas vezes contra o mesmo movimento vivo.
-- Parcial: um vinculo desfeito nao impede refazer o vinculo depois de corrigido.
CREATE UNIQUE INDEX IF NOT EXISTS ux_conciliacao_ativa_parcela
    ON conciliacao (transacao_bancaria_id, titulo_parcela_id)
    WHERE desfeita_em IS NULL AND titulo_parcela_id IS NOT NULL;

-- A baixa tambem so responde por um movimento vivo de cada vez.
CREATE UNIQUE INDEX IF NOT EXISTS ux_conciliacao_ativa_baixa
    ON conciliacao (titulo_baixa_id)
    WHERE desfeita_em IS NULL AND titulo_baixa_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_conciliacao_empresa_periodo
    ON conciliacao (empresa_id, criado_em DESC);

CREATE INDEX IF NOT EXISTS ix_conciliacao_divergente
    ON conciliacao (empresa_id, criado_em DESC)
    WHERE desfeita_em IS NULL AND possui_divergencia;

-- O que a conciliacao pode e o que ela nao pode.
--
-- Duas travas de concorrencia num lugar so: o `SELECT ... FOR UPDATE` do
-- movimento serializa as conciliacoes concorrentes daquele movimento, e e sob
-- esse lock que a soma dos vinculos vivos e conferida. Sem ele, duas sessoes
-- leriam "ainda cabe R$ 1.000" ao mesmo tempo e as duas gravariam.
CREATE OR REPLACE FUNCTION fn_valida_conciliacao() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_mov       record;
    v_tipo      enum_tipo_titulo;
    v_status    enum_status_parcela;
    v_conciliado dom_valor;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        -- Fora do desfazimento e da confirmacao, a conciliacao e imutavel: ela
        -- e evidencia de uma decisao tomada numa data (RF-077).
        IF (NEW.empresa_id, NEW.transacao_bancaria_id, NEW.titulo_parcela_id,
            NEW.titulo_baixa_id, NEW.transacao_pagamento_id, NEW.valor_conciliado,
            NEW.diferenca, NEW.origem, NEW.criado_em)
           IS DISTINCT FROM
           (OLD.empresa_id, OLD.transacao_bancaria_id, OLD.titulo_parcela_id,
            OLD.titulo_baixa_id, OLD.transacao_pagamento_id, OLD.valor_conciliado,
            OLD.diferenca, OLD.origem, OLD.criado_em) THEN
            RAISE EXCEPTION
                'A conciliacao % nao se altera: desfaca e registre outra (RF-077).', OLD.id;
        END IF;
        IF OLD.desfeita_em IS NOT NULL AND NEW.desfeita_em IS DISTINCT FROM OLD.desfeita_em THEN
            RAISE EXCEPTION 'A conciliacao % ja foi desfeita em %.', OLD.id, OLD.desfeita_em;
        END IF;
        RETURN NEW;
    END IF;

    SELECT tb.conta_bancaria_id, tb.sentido, tb.valor, tb.data_movimento, tb.status_conciliacao
      INTO v_mov
      FROM transacao_bancaria tb
     WHERE tb.id = NEW.transacao_bancaria_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Movimento bancario % nao encontrado.', NEW.transacao_bancaria_id;
    END IF;

    IF v_mov.status_conciliacao = 'IGNORADO' THEN
        RAISE EXCEPTION
            'O movimento % foi marcado como ignorado: reative-o antes de conciliar (RF-074).',
            NEW.transacao_bancaria_id;
    END IF;

    -- Sentido do dinheiro contra natureza do titulo: credito no extrato so
    -- corresponde a titulo a RECEBER, debito so a PAGAR. E o erro mais caro da
    -- conciliacao manual -- baixar um pagamento com o dinheiro que entrou.
    IF NEW.titulo_parcela_id IS NOT NULL THEN
        SELECT t.tipo, p.status
          INTO v_tipo, v_status
          FROM titulo_parcela p
          JOIN titulo t ON t.id = p.titulo_id
         WHERE p.id = NEW.titulo_parcela_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Parcela % nao encontrada.', NEW.titulo_parcela_id;
        END IF;
        IF (v_mov.sentido = 'CREDITO' AND v_tipo <> 'RECEBER')
        OR (v_mov.sentido = 'DEBITO'  AND v_tipo <> 'PAGAR') THEN
            RAISE EXCEPTION
                'Movimento % nao corresponde a um titulo a %  (RF-074).',
                v_mov.sentido, v_tipo;
        END IF;
        IF v_status = 'CANCELADA' THEN
            RAISE EXCEPTION 'A parcela % esta cancelada e nao concilia (RF-074).',
                NEW.titulo_parcela_id;
        END IF;
    END IF;

    -- A soma dos vinculos vivos nao passa do que o banco movimentou.
    SELECT coalesce(sum(c.valor_conciliado), 0)
      INTO v_conciliado
      FROM conciliacao c
     WHERE c.transacao_bancaria_id = NEW.transacao_bancaria_id
       AND c.desfeita_em IS NULL;

    IF v_conciliado + NEW.valor_conciliado > v_mov.valor THEN
        RAISE EXCEPTION
            'Conciliar % excede o movimento %: valor % e % ja conciliado (RF-076).',
            NEW.valor_conciliado, NEW.transacao_bancaria_id, v_mov.valor, v_conciliado;
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_valida_conciliacao() IS
    'RF-074/RF-076 - sentido coerente, parcela viva e soma limitada ao movimento, sob lock.';

DROP TRIGGER IF EXISTS trg_valida_conciliacao ON conciliacao;
CREATE TRIGGER trg_valida_conciliacao
    BEFORE INSERT OR UPDATE ON conciliacao
    FOR EACH ROW EXECUTE FUNCTION fn_valida_conciliacao();

-- -----------------------------------------------------------------------------
-- 6. RF-072 / RF-076: o status do movimento e derivado, nunca digitado
--
-- Deixar a aplicacao escrever `status_conciliacao` seria manter dois numeros
-- para o mesmo fato: as conciliacoes vivas e o rotulo. Aqui o rotulo e funcao
-- delas -- e continua correto depois de um desfazimento, de uma conciliacao
-- parcial ou de um processo que morreu no meio.
--
-- IGNORADO e a unica excecao, porque e uma decisao humana sobre um movimento
-- que nao tem par (tarifa, rendimento, transferencia entre contas proprias): o
-- gatilho o preserva enquanto nao houver vinculo.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_atualiza_status_conciliacao() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_mov_id     uuid;
    v_valor      dom_valor;
    v_atual      enum_status_conciliacao;
    v_conciliado dom_valor;
    v_confirmado dom_valor;
    v_divergente boolean;
    v_novo       enum_status_conciliacao;
BEGIN
    v_mov_id := coalesce(NEW.transacao_bancaria_id, OLD.transacao_bancaria_id);

    SELECT tb.valor, tb.status_conciliacao
      INTO v_valor, v_atual
      FROM transacao_bancaria tb
     WHERE tb.id = v_mov_id;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    SELECT coalesce(sum(c.valor_conciliado), 0),
           coalesce(sum(c.valor_conciliado) FILTER (WHERE c.confirmada), 0),
           coalesce(bool_or(c.possui_divergencia), false)
      INTO v_conciliado, v_confirmado, v_divergente
      FROM conciliacao c
     WHERE c.transacao_bancaria_id = v_mov_id
       AND c.desfeita_em IS NULL;

    IF v_conciliado = 0 THEN
        -- Sem vinculo vivo o movimento volta para a fila -- a menos que alguem
        -- tenha decidido que ele nao tem par.
        v_novo := CASE WHEN v_atual = 'IGNORADO' THEN 'IGNORADO' ELSE 'NAO_CONCILIADO' END;
    ELSIF v_divergente THEN
        v_novo := 'DIVERGENTE';
    ELSIF v_confirmado >= v_valor THEN
        v_novo := 'CONCILIADO';
    ELSIF v_confirmado > 0 THEN
        -- Conciliado em parte: ainda sobra extrato sem par, e isso e divergencia
        -- a investigar, nao conciliacao concluida (RF-076).
        v_novo := 'DIVERGENTE';
    ELSE
        v_novo := 'SUGERIDO';
    END IF;

    IF v_novo IS DISTINCT FROM v_atual THEN
        UPDATE transacao_bancaria SET status_conciliacao = v_novo WHERE id = v_mov_id;
    END IF;

    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION fn_atualiza_status_conciliacao() IS
    'RF-072/RF-076 - status do movimento e projecao das conciliacoes vivas.';

DROP TRIGGER IF EXISTS trg_atualiza_status_conciliacao ON conciliacao;
CREATE TRIGGER trg_atualiza_status_conciliacao
    AFTER INSERT OR UPDATE ON conciliacao
    FOR EACH ROW EXECUTE FUNCTION fn_atualiza_status_conciliacao();

-- -----------------------------------------------------------------------------
-- 7. RF-077: historico
--
-- A conciliacao nao se apaga. Uma conciliacao errada que some leva junto a
-- evidencia de que ela existiu, de quem a fez e de quando -- que e exatamente
-- o que se procura quando o saldo nao fecha.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_bloqueia_delete_conciliacao() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION
        'Conciliacao nao e removida: registre o desfazimento em desfeita_em (RF-077).';
END;
$$;

DROP TRIGGER IF EXISTS trg_conciliacao_sem_delete ON conciliacao;
CREATE TRIGGER trg_conciliacao_sem_delete
    BEFORE DELETE ON conciliacao
    FOR EACH ROW EXECUTE FUNCTION fn_bloqueia_delete_conciliacao();

REVOKE DELETE ON conciliacao FROM app_gestao;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sge_api') THEN
        REVOKE DELETE ON gestao.conciliacao FROM sge_api;
    END IF;
END $$;

COMMENT ON TABLE conciliacao IS
    'RF-073 a RF-077 - vinculo entre movimento bancario e lancamento interno; append-only.';

-- -----------------------------------------------------------------------------
-- 8. RN-001 / RN-002: RLS revalidada
--
-- As duas tabelas ganharam colunas e restricoes neste script. A politica
-- generica de 03 continua correta para elas (empresa_id NOT NULL nas duas), mas
-- recria-la aqui e o que garante que uma reexecucao parcial de 03, ou uma
-- tabela restaurada de backup, nao deixe uma delas sem politica -- e sem
-- politica com FORCE RLS a tabela nao responde, o que esconderia o problema
-- como "bug de consulta".
-- -----------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['conciliacao','regra_conciliacao'] LOOP
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
-- FIM - 14_conciliacao_sprint11.sql
-- =============================================================================
