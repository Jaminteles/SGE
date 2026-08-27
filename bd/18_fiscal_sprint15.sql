-- =============================================================================
-- 18_fiscal_sprint15.sql
-- Sprint 15 - Fase 7 (Contabil/Fiscal): M12 - Fiscal (RF-088 a RF-094).
--
-- Executar como gestao_owner, depois de 01 a 17:
--   psql -U gestao_owner -h localhost -d gestao_empresarial -f 18_fiscal_sprint15.sql
-- Idempotente: pode ser reexecutado.
--
-- O que 03 ja entregava: as tabelas `parametro_fiscal`, `classificacao_fiscal`,
-- `regra_fiscal` e `evento_fiscal`, com PK, FK para empresa, a unique de
-- (empresa, tipo, codigo) da classificacao, o CHECK de vigencia do parametro e
-- os loops genericos de `atualizado_em`, RLS e GRANT. Faltava tudo o que separa
-- quatro tabelas de um modulo fiscal confiavel:
--   1.  RN-001 - referencias presas a mesma empresa
--   2.  RF-088 - vigencia sem sobreposicao e coerente com o regime
--   3.  RF-089 - codigo conferido contra o tipo da classificacao
--   4.  RF-090 - a linha da nota aponta a classificacao fiscal da empresa
--   5.  RF-091 - regra com criterio, vigencia e desempate deterministico
--   6.  RF-092 - evento com sequencia unica, protocolo idempotente e imutavel
--   7.  RF-093 - views de apuracao e livro fiscal com a RLS de quem chama
--   8.  RF-094 - catalogo de provedores fiscais
--   9.  RN-010 - as quatro tabelas auditadas
--   10. RN-001/RN-002 - RLS revalidada
--
-- Decisao estrutural desta sprint: **a nota de terceiro nao e recalculada**.
-- bd/12 ja dizia isso dos valores; aqui vale para a tributacao inteira. A regra
-- fiscal (RF-091) resolve o tratamento esperado de uma operacao e a
-- classificacao (RF-089) descreve o que a empresa cadastrou -- nenhuma das duas
-- reescreve `valor_icms` de um documento recebido. Onde o esperado difere do
-- declarado, o sistema **aponta a divergencia**; corrigir XML de terceiro para
-- que ele pareca certo e perder a prova do que foi recebido.
--
-- Segunda decisao: **o evento fiscal nao se apaga e nao se reescreve**. Depois
-- de registrado, so `status`, `protocolo` e `retorno` mudam -- e so no sentido
-- do transporte (REGISTRADO -> TRANSMITIDO -> AUTORIZADO/REJEITADO). Um
-- cancelamento cuja justificativa pode ser reescrita depois da autorizacao nao
-- serve como prova de nada, e e justamente como prova que ele existe.
-- =============================================================================

SET search_path TO gestao, public;

-- -----------------------------------------------------------------------------
-- 1. RN-001: referencia fiscal presa a mesma empresa
--
-- As FKs de 03 apontam so o id. Um `produto_id` de outra empresa numa regra
-- fiscal nao viola FK nenhuma, e a RLS tambem nao o impede: a linha gravada e da
-- empresa corrente, o alvo e que e de fora. O efeito seria uma regra que decide
-- a tributacao de um produto que o dono da regra nao pode nem enxergar.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_valida_empresa_referencia_fiscal() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_empresa uuid;
BEGIN
    IF TG_TABLE_NAME = 'parametro_fiscal' THEN
        IF NEW.filial_id IS NOT NULL THEN
            SELECT empresa_id INTO v_empresa FROM filial WHERE id = NEW.filial_id;
            IF v_empresa IS DISTINCT FROM NEW.empresa_id THEN
                RAISE EXCEPTION 'A filial do parametro fiscal e de outra empresa (RN-001).';
            END IF;
        END IF;

    ELSIF TG_TABLE_NAME = 'regra_fiscal' THEN
        IF NEW.produto_id IS NOT NULL THEN
            SELECT empresa_id INTO v_empresa FROM produto WHERE id = NEW.produto_id;
            IF v_empresa IS DISTINCT FROM NEW.empresa_id THEN
                RAISE EXCEPTION 'O produto da regra fiscal e de outra empresa (RN-001).';
            END IF;
        END IF;
        IF NEW.categoria_produto_id IS NOT NULL THEN
            SELECT empresa_id INTO v_empresa FROM categoria_produto WHERE id = NEW.categoria_produto_id;
            IF v_empresa IS DISTINCT FROM NEW.empresa_id THEN
                RAISE EXCEPTION 'A categoria de produto da regra fiscal e de outra empresa (RN-001).';
            END IF;
        END IF;
        IF NEW.classificacao_fiscal_id IS NOT NULL THEN
            SELECT empresa_id INTO v_empresa FROM classificacao_fiscal WHERE id = NEW.classificacao_fiscal_id;
            IF v_empresa IS DISTINCT FROM NEW.empresa_id THEN
                RAISE EXCEPTION 'A classificacao fiscal da regra e de outra empresa (RN-001).';
            END IF;
        END IF;

    ELSIF TG_TABLE_NAME = 'evento_fiscal' THEN
        IF NEW.documento_fiscal_id IS NOT NULL THEN
            SELECT empresa_id INTO v_empresa FROM documento_fiscal WHERE id = NEW.documento_fiscal_id;
            IF v_empresa IS DISTINCT FROM NEW.empresa_id THEN
                RAISE EXCEPTION 'O documento fiscal do evento e de outra empresa (RN-001).';
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_valida_empresa_referencia_fiscal() IS
    'RN-001 - toda referencia de parametro, regra e evento fiscal pertence a mesma empresa da linha.';

DROP TRIGGER IF EXISTS trg_parametro_fiscal_empresa ON parametro_fiscal;
CREATE TRIGGER trg_parametro_fiscal_empresa
    BEFORE INSERT OR UPDATE ON parametro_fiscal
    FOR EACH ROW EXECUTE FUNCTION fn_valida_empresa_referencia_fiscal();

DROP TRIGGER IF EXISTS trg_regra_fiscal_empresa ON regra_fiscal;
CREATE TRIGGER trg_regra_fiscal_empresa
    BEFORE INSERT OR UPDATE ON regra_fiscal
    FOR EACH ROW EXECUTE FUNCTION fn_valida_empresa_referencia_fiscal();

DROP TRIGGER IF EXISTS trg_evento_fiscal_empresa ON evento_fiscal;
CREATE TRIGGER trg_evento_fiscal_empresa
    BEFORE INSERT OR UPDATE ON evento_fiscal
    FOR EACH ROW EXECUTE FUNCTION fn_valida_empresa_referencia_fiscal();

-- -----------------------------------------------------------------------------
-- 2. RF-088: a vigencia do parametro fiscal nao se sobrepoe
--
-- O parametro responde "qual era o regime tributario desta empresa naquela
-- data". Se duas linhas cobrem a mesma data, a pergunta passa a ter duas
-- respostas, e quem apura escolhe uma delas por ordem de leitura -- que muda com
-- o plano de execucao. A exclusao por periodo e a unica forma de a pergunta
-- continuar tendo uma resposta so.
--
-- `filial_id` nulo e o parametro da empresa inteira: normalizado para o uuid
-- zero porque, em EXCLUDE, nulo nao conflita com nulo -- e duas linhas "da
-- empresa inteira" sobrepostas sao exatamente o caso a impedir.
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.parametro_fiscal'::regclass
                      AND conname = 'ex_parametro_fiscal_vigencia') THEN
        ALTER TABLE parametro_fiscal ADD CONSTRAINT ex_parametro_fiscal_vigencia
            EXCLUDE USING gist (
                empresa_id WITH =,
                coalesce(filial_id, '00000000-0000-0000-0000-000000000000'::uuid) WITH =,
                daterange(vigencia_inicio, coalesce(vigencia_fim, 'infinity'::date), '[]') WITH &&
            );
    END IF;
END $$;

COMMENT ON CONSTRAINT ex_parametro_fiscal_vigencia ON parametro_fiscal IS
    'RF-088 - uma empresa/filial tem um unico parametro fiscal vigente em cada data.';

-- O regime decide quais aliquotas fazem sentido. Aliquota do Simples numa
-- empresa de Lucro Real nao e um campo a mais: e um numero que entra na apuracao
-- de quem nao esta no Simples.
CREATE OR REPLACE FUNCTION fn_valida_parametro_fiscal() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.regime_tributario <> 'SIMPLES_NACIONAL' AND NEW.aliquota_simples IS NOT NULL THEN
        RAISE EXCEPTION
            'Aliquota do Simples so se aplica ao regime SIMPLES_NACIONAL; o parametro esta como % (RF-088).',
            NEW.regime_tributario;
    END IF;

    IF NEW.regime_tributario = 'MEI' AND NEW.contribuinte_ipi THEN
        RAISE EXCEPTION 'MEI nao e contribuinte de IPI (RF-088).';
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_valida_parametro_fiscal() IS
    'RF-088 - as aliquotas do parametro precisam fazer sentido no regime declarado.';

DROP TRIGGER IF EXISTS trg_valida_parametro_fiscal ON parametro_fiscal;
CREATE TRIGGER trg_valida_parametro_fiscal
    BEFORE INSERT OR UPDATE ON parametro_fiscal
    FOR EACH ROW EXECUTE FUNCTION fn_valida_parametro_fiscal();

-- -----------------------------------------------------------------------------
-- 3. RF-089: o codigo e conferido contra o tipo da classificacao
--
-- NCM tem 8 digitos, CEST 7, CFOP 4. Um NCM de 7 digitos cadastrado como NCM
-- nao gera erro nenhum: ele simplesmente nunca casa com item nenhum, e a regra
-- fiscal presa a ele deixa de valer sem que ninguem perceba.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.classificacao_fiscal'::regclass
                      AND conname = 'ck_classificacao_fiscal_tipo') THEN
        ALTER TABLE classificacao_fiscal ADD CONSTRAINT ck_classificacao_fiscal_tipo
            CHECK (tipo IN ('NCM','CEST','CFOP','CST','LC116'));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.classificacao_fiscal'::regclass
                      AND conname = 'ck_classificacao_fiscal_codigo') THEN
        ALTER TABLE classificacao_fiscal ADD CONSTRAINT ck_classificacao_fiscal_codigo
            CHECK (
                (tipo = 'NCM'   AND codigo ~ '^[0-9]{8}$') OR
                (tipo = 'CEST'  AND codigo ~ '^[0-9]{7}$') OR
                (tipo = 'CFOP'  AND codigo ~ '^[1-7][0-9]{3}$') OR
                (tipo = 'CST'   AND codigo ~ '^[0-9]{2,4}$') OR
                (tipo = 'LC116' AND codigo ~ '^[0-9]{2}\.[0-9]{2}$')
            );
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_classificacao_fiscal_tipo
    ON classificacao_fiscal (empresa_id, tipo, codigo)
    WHERE ativo;

-- -----------------------------------------------------------------------------
-- 4. RF-090: a linha da nota aponta a classificacao fiscal da empresa
--
-- O item ja guarda ncm, cest, cfop e os tributos -- **como o emitente
-- declarou**, e isso continua imutavel (bd/12). O que faltava era ligar aquele
-- NCM ao cadastro da empresa: sem o vinculo, "quanto de ICMS este NCM deveria
-- ter" e uma pergunta que so se responde comparando texto em relatorio.
--
-- A coluna nao entra na lista de imutabilidade de
-- `fn_prepara_documento_fiscal_item` (bd/12) de proposito -- ela e classificacao
-- **nossa**, como `produto_id`, e nao declaracao do emitente. Reclassificar nao
-- reescreve nada do que foi recebido.
-- -----------------------------------------------------------------------------
ALTER TABLE documento_fiscal_item
    ADD COLUMN IF NOT EXISTS classificacao_fiscal_id uuid;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.documento_fiscal_item'::regclass
                      AND conname = 'fk_documento_fiscal_item_classificacao') THEN
        ALTER TABLE documento_fiscal_item
            ADD CONSTRAINT fk_documento_fiscal_item_classificacao
            FOREIGN KEY (classificacao_fiscal_id)
            REFERENCES classificacao_fiscal(id) ON DELETE SET NULL;
    END IF;
END $$;

COMMENT ON COLUMN documento_fiscal_item.classificacao_fiscal_id IS
    'RF-090 - classificacao fiscal da empresa correspondente ao NCM declarado. Nao altera o declarado.';

CREATE INDEX IF NOT EXISTS ix_documento_fiscal_item_classificacao
    ON documento_fiscal_item (classificacao_fiscal_id)
    WHERE classificacao_fiscal_id IS NOT NULL;

-- Os relatorios do RF-093 agrupam por CFOP e por NCM dentro de um periodo.
CREATE INDEX IF NOT EXISTS ix_documento_fiscal_item_cfop
    ON documento_fiscal_item (empresa_id, cfop);
CREATE INDEX IF NOT EXISTS ix_documento_fiscal_item_ncm
    ON documento_fiscal_item (empresa_id, ncm);

-- A classificacao vinculada ao item e da mesma empresa e e de NCM: o item tem um
-- NCM declarado, e e a esse cadastro que ele se liga. CFOP e CST descrevem a
-- operacao, nao a mercadoria -- eles entram pela regra fiscal (RF-091).
CREATE OR REPLACE FUNCTION fn_valida_classificacao_item_fiscal() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_classificacao record;
BEGIN
    IF NEW.classificacao_fiscal_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT empresa_id, tipo, ativo INTO v_classificacao
      FROM classificacao_fiscal WHERE id = NEW.classificacao_fiscal_id;

    IF v_classificacao.empresa_id IS DISTINCT FROM NEW.empresa_id THEN
        RAISE EXCEPTION 'A classificacao fiscal do item e de outra empresa (RN-001).';
    END IF;
    IF v_classificacao.tipo <> 'NCM' THEN
        RAISE EXCEPTION
            'O item da nota se classifica por NCM; a classificacao informada e do tipo % (RF-090).',
            v_classificacao.tipo;
    END IF;
    IF NOT v_classificacao.ativo THEN
        RAISE EXCEPTION 'A classificacao fiscal informada esta inativa (RF-089).';
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_valida_classificacao_item_fiscal() IS
    'RF-090 - o item so se liga a uma classificacao de NCM, ativa e da propria empresa.';

DROP TRIGGER IF EXISTS trg_valida_classificacao_item_fiscal ON documento_fiscal_item;
CREATE TRIGGER trg_valida_classificacao_item_fiscal
    BEFORE INSERT OR UPDATE OF classificacao_fiscal_id ON documento_fiscal_item
    FOR EACH ROW EXECUTE FUNCTION fn_valida_classificacao_item_fiscal();

-- -----------------------------------------------------------------------------
-- 5. RF-091: a regra fiscal precisa de criterio, vigencia e desempate
--
-- Uma regra sem nenhum criterio casa com toda operacao da empresa. Como a
-- resolucao ordena por prioridade, uma regra assim gravada com prioridade baixa
-- passa a decidir a tributacao de tudo -- e o sintoma aparece semanas depois, no
-- CFOP errado de uma nota qualquer.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.regra_fiscal'::regclass
                      AND conname = 'ck_regra_fiscal_criterio') THEN
        ALTER TABLE regra_fiscal ADD CONSTRAINT ck_regra_fiscal_criterio
            CHECK (
                produto_id IS NOT NULL
                OR categoria_produto_id IS NOT NULL
                OR classificacao_fiscal_id IS NOT NULL
                OR tipo_operacao IS NOT NULL
                OR uf_origem IS NOT NULL
                OR uf_destino IS NOT NULL
            );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.regra_fiscal'::regclass
                      AND conname = 'ck_regra_fiscal_vigencia') THEN
        ALTER TABLE regra_fiscal ADD CONSTRAINT ck_regra_fiscal_vigencia
            CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.regra_fiscal'::regclass
                      AND conname = 'ck_regra_fiscal_operacao') THEN
        ALTER TABLE regra_fiscal ADD CONSTRAINT ck_regra_fiscal_operacao
            CHECK (tipo_operacao IS NULL
                   OR tipo_operacao IN ('COMPRA','VENDA','TRANSFERENCIA','DEVOLUCAO'));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.regra_fiscal'::regclass
                      AND conname = 'ck_regra_fiscal_prioridade') THEN
        ALTER TABLE regra_fiscal ADD CONSTRAINT ck_regra_fiscal_prioridade
            CHECK (prioridade BETWEEN 1 AND 999);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.regra_fiscal'::regclass
                      AND conname = 'ck_regra_fiscal_cfop') THEN
        ALTER TABLE regra_fiscal ADD CONSTRAINT ck_regra_fiscal_cfop
            CHECK (cfop IS NULL OR cfop ~ '^[1-7][0-9]{3}$');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.regra_fiscal'::regclass
                      AND conname = 'uq_regra_fiscal_nome') THEN
        ALTER TABLE regra_fiscal ADD CONSTRAINT uq_regra_fiscal_nome
            UNIQUE (empresa_id, nome);
    END IF;
END $$;

-- A resolucao (RF-091) filtra por empresa, vigencia e criterio, e ordena por
-- prioridade. O indice de 03 cobria (empresa, prioridade) WHERE ativo; este
-- acrescenta a vigencia, que e o filtro que sobra em toda consulta.
CREATE INDEX IF NOT EXISTS ix_regra_fiscal_vigencia
    ON regra_fiscal (empresa_id, vigencia_inicio, vigencia_fim)
    WHERE ativo;

-- -----------------------------------------------------------------------------
-- 6. RF-092: o evento fiscal e unico, idempotente e imutavel
--
-- Tres garantias, e cada uma cobre um jeito de o evento deixar de servir como
-- prova:
--
--  a. **sequencia unica por documento e tipo**. A SEFAZ numera a carta de
--     correcao; duas CC-e com a mesma sequencia sao duas versoes do mesmo
--     documento oficial, e nao ha como saber qual foi a transmitida;
--  b. **protocolo unico por empresa**. O protocolo e a resposta do fisco. Um
--     retry do job que grave o mesmo protocolo em dois eventos transforma uma
--     autorizacao em duas -- e a segunda nao existe;
--  c. **corpo imutavel apos o registro**. Tipo, justificativa, XML e documento
--     nao mudam. So o transporte anda: status, protocolo e retorno.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.evento_fiscal'::regclass
                      AND conname = 'ck_evento_fiscal_tipo') THEN
        ALTER TABLE evento_fiscal ADD CONSTRAINT ck_evento_fiscal_tipo
            CHECK (tipo IN ('CANCELAMENTO','CCE','MANIFESTACAO','INUTILIZACAO'));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.evento_fiscal'::regclass
                      AND conname = 'ck_evento_fiscal_status') THEN
        ALTER TABLE evento_fiscal ADD CONSTRAINT ck_evento_fiscal_status
            CHECK (status IN ('REGISTRADO','TRANSMITIDO','AUTORIZADO','REJEITADO'));
    END IF;

    -- Cancelamento e carta de correcao exigem justificativa; o layout da SEFAZ
    -- pede no minimo 15 caracteres, e o motivo em branco e a informacao que
    -- falta justamente quando alguem pergunta por que a nota foi cancelada.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.evento_fiscal'::regclass
                      AND conname = 'ck_evento_fiscal_justificativa') THEN
        ALTER TABLE evento_fiscal ADD CONSTRAINT ck_evento_fiscal_justificativa
            CHECK (tipo NOT IN ('CANCELAMENTO','CCE')
                   OR (justificativa IS NOT NULL AND length(btrim(justificativa)) >= 15));
    END IF;

    -- Inutilizacao nao se refere a documento recebido: e a faixa de numeracao
    -- que ficou sem uso. Os outros tres sempre tem documento.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.evento_fiscal'::regclass
                      AND conname = 'ck_evento_fiscal_documento') THEN
        ALTER TABLE evento_fiscal ADD CONSTRAINT ck_evento_fiscal_documento
            CHECK (tipo = 'INUTILIZACAO' OR documento_fiscal_id IS NOT NULL);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'gestao.evento_fiscal'::regclass
                      AND conname = 'ck_evento_fiscal_sequencia') THEN
        ALTER TABLE evento_fiscal ADD CONSTRAINT ck_evento_fiscal_sequencia
            CHECK (sequencia_evento IS NULL OR sequencia_evento BETWEEN 1 AND 20);
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_evento_fiscal_sequencia
    ON evento_fiscal (empresa_id, documento_fiscal_id, tipo, sequencia_evento)
    WHERE documento_fiscal_id IS NOT NULL AND sequencia_evento IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_evento_fiscal_protocolo
    ON evento_fiscal (empresa_id, protocolo)
    WHERE protocolo IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_evento_fiscal_pendente
    ON evento_fiscal (empresa_id, data_evento)
    WHERE status IN ('REGISTRADO','TRANSMITIDO');

CREATE OR REPLACE FUNCTION fn_evento_fiscal_imutavel() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION
            'Evento fiscal nao e removido: ele e a prova do que foi transmitido ao fisco (RF-092).';
    END IF;

    IF (NEW.empresa_id, NEW.documento_fiscal_id, NEW.tipo, NEW.sequencia_evento,
        NEW.justificativa, NEW.xml_conteudo, NEW.data_evento)
       IS DISTINCT FROM
       (OLD.empresa_id, OLD.documento_fiscal_id, OLD.tipo, OLD.sequencia_evento,
        OLD.justificativa, OLD.xml_conteudo, OLD.data_evento) THEN
        RAISE EXCEPTION
            'O evento fiscal % ja esta registrado: so status, protocolo e retorno mudam (RF-092).',
            OLD.id;
    END IF;

    -- O transporte so anda para frente. AUTORIZADO e REJEITADO sao terminais: a
    -- resposta do fisco nao e revista por retentativa do nosso lado.
    IF OLD.status IN ('AUTORIZADO','REJEITADO') AND NEW.status <> OLD.status THEN
        RAISE EXCEPTION
            'O evento fiscal % ja teve resposta do fisco (%) e nao volta a ser transmitido (RF-092).',
            OLD.id, OLD.status;
    END IF;

    IF OLD.status = 'TRANSMITIDO' AND NEW.status = 'REGISTRADO' THEN
        RAISE EXCEPTION 'Evento fiscal transmitido nao volta para REGISTRADO (RF-092).';
    END IF;

    IF NEW.status IN ('AUTORIZADO','REJEITADO') AND NEW.protocolo IS NULL THEN
        RAISE EXCEPTION
            'Resposta do fisco sem protocolo nao e resposta: informe o protocolo (RF-092).';
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_evento_fiscal_imutavel() IS
    'RF-092 - evento registrado nao muda de corpo nem se apaga; so o transporte avanca.';

DROP TRIGGER IF EXISTS trg_evento_fiscal_imutavel ON evento_fiscal;
CREATE TRIGGER trg_evento_fiscal_imutavel
    BEFORE UPDATE OR DELETE ON evento_fiscal
    FOR EACH ROW EXECUTE FUNCTION fn_evento_fiscal_imutavel();

-- -----------------------------------------------------------------------------
-- 7. RF-093: apuracao e livro fiscal
--
-- As duas views saem de `documento_fiscal` e `documento_fiscal_item` -- o
-- declarado, sem recalculo. O que elas fazem e o que nenhuma consulta avulsa
-- deveria refazer a cada relatorio: excluir o que nao entra na apuracao.
--
-- Fora ficam CANCELADO, DENEGADO e DUPLICADO. Nota cancelada nao gera imposto;
-- denegada nunca existiu; duplicada e a segunda chegada da mesma nota, e somar
-- as duas dobraria o ICMS do mes.
--
-- A competencia e a data de emissao, nao a de entrada: e por ela que a apuracao
-- e entregue.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS vw_livro_fiscal_cfop;
DROP VIEW IF EXISTS vw_apuracao_fiscal;

CREATE VIEW vw_apuracao_fiscal AS
SELECT d.empresa_id,
       d.filial_id,
       date_trunc('month', d.data_emissao)::date AS competencia,
       CASE d.tipo_operacao WHEN '0' THEN 'ENTRADA' WHEN '1' THEN 'SAIDA' ELSE 'INDEFINIDO' END
           AS sentido,
       d.modelo,
       count(*)                     AS documentos,
       sum(d.valor_total)           AS valor_total,
       sum(d.valor_produtos)        AS valor_produtos,
       sum(d.valor_icms)            AS valor_icms,
       sum(d.valor_icms_st)         AS valor_icms_st,
       sum(d.valor_ipi)             AS valor_ipi,
       sum(d.valor_pis)             AS valor_pis,
       sum(d.valor_cofins)          AS valor_cofins,
       sum(d.valor_iss)             AS valor_iss
FROM documento_fiscal d
WHERE d.status NOT IN ('CANCELADO','DENEGADO','DUPLICADO')
GROUP BY d.empresa_id, d.filial_id, date_trunc('month', d.data_emissao),
         d.tipo_operacao, d.modelo;

COMMENT ON VIEW vw_apuracao_fiscal IS
    'RF-093 - apuracao mensal por sentido e modelo, sobre o declarado. Exclui cancelado, denegado e duplicado.';

CREATE VIEW vw_livro_fiscal_cfop AS
SELECT d.empresa_id,
       d.filial_id,
       date_trunc('month', d.data_emissao)::date AS competencia,
       CASE d.tipo_operacao WHEN '0' THEN 'ENTRADA' WHEN '1' THEN 'SAIDA' ELSE 'INDEFINIDO' END
           AS sentido,
       i.cfop,
       i.ncm,
       count(*)                  AS itens,
       sum(i.valor_total)        AS valor_total,
       sum(i.base_calculo_icms)  AS base_calculo_icms,
       sum(i.valor_icms)         AS valor_icms,
       sum(i.valor_icms_st)      AS valor_icms_st,
       sum(i.valor_ipi)          AS valor_ipi,
       sum(i.valor_pis)          AS valor_pis,
       sum(i.valor_cofins)       AS valor_cofins
FROM documento_fiscal_item i
JOIN documento_fiscal d ON d.id = i.documento_fiscal_id
WHERE d.status NOT IN ('CANCELADO','DENEGADO','DUPLICADO')
GROUP BY d.empresa_id, d.filial_id, date_trunc('month', d.data_emissao),
         d.tipo_operacao, i.cfop, i.ncm;

COMMENT ON VIEW vw_livro_fiscal_cfop IS
    'RF-093 - livro de entradas e saidas por CFOP e NCM, sobre o declarado nas linhas da nota.';

-- As views precisam da RLS de quem consulta, e nao da do dono do schema: sem
-- isso o relatorio fiscal de uma empresa mostraria o movimento de todas.
DO $$
BEGIN
    IF current_setting('server_version_num')::int >= 150000 THEN
        EXECUTE 'ALTER VIEW gestao.vw_apuracao_fiscal   SET (security_invoker = true)';
        EXECUTE 'ALTER VIEW gestao.vw_livro_fiscal_cfop SET (security_invoker = true)';
    ELSE
        RAISE NOTICE 'PostgreSQL < 15: views fiscais seguem com RLS do owner (isolamento mantido).';
    END IF;
END $$;

GRANT SELECT ON vw_apuracao_fiscal, vw_livro_fiscal_cfop TO app_gestao;

-- -----------------------------------------------------------------------------
-- 8. RF-094: catalogo de provedores fiscais
--
-- Mesmo desenho do M09 e do M13: o adaptador manual e o estado inicial de toda
-- empresa. Sem ele, quem ainda transmite pelo emissor da contabilidade nao
-- conseguiria registrar um evento -- e registrar o evento e o que importa aqui;
-- transmitir e o passo seguinte.
-- -----------------------------------------------------------------------------
INSERT INTO provider (codigo, nome, categoria, descricao, capacidades) VALUES
 ('FISCAL_MANUAL','Transmissao manual (sem integracao)','FISCAL',
  'O evento e registrado no sistema e transmitido por fora; o protocolo volta a mao (RF-092).',
  '{"evento":true,"automatico":false}')
ON CONFLICT (codigo) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 9. RN-010: as quatro tabelas fiscais sao auditadas
--
-- Nenhuma delas estava na lista de 03. Sao todas tabelas de decisao: mudar o
-- regime tributario, a aliquota de uma classificacao ou o CFOP de uma regra
-- muda a apuracao de tudo o que passar por ali depois -- e o evento fiscal e
-- prova entregue ao fisco.
-- -----------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'parametro_fiscal','classificacao_fiscal','regra_fiscal','evento_fiscal'
    ] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_trigger
                        WHERE tgrelid = format('gestao.%I', t)::regclass
                          AND tgname = format('trg_%s_auditoria', t)) THEN
            EXECUTE format(
                'CREATE TRIGGER trg_%1$s_auditoria
                 AFTER INSERT OR UPDATE OR DELETE ON gestao.%1$I
                 FOR EACH ROW EXECUTE FUNCTION gestao.fn_auditoria_generica();', t);
        END IF;
    END LOOP;
END $$;

-- `classificacao_fiscal` nao tinha `atualizado_em` e por isso ficou de fora do
-- loop de 03. Passa a ter: alterar a aliquota de um NCM e alteracao, e "quando
-- mudou" e parte da resposta.
ALTER TABLE classificacao_fiscal
    ADD COLUMN IF NOT EXISTS atualizado_em timestamptz NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_classificacao_fiscal_atualizado_em ON classificacao_fiscal;
CREATE TRIGGER trg_classificacao_fiscal_atualizado_em
    BEFORE UPDATE ON classificacao_fiscal
    FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();

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
        'parametro_fiscal','classificacao_fiscal','regra_fiscal','evento_fiscal'
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
-- FIM - 18_fiscal_sprint15.sql
-- =============================================================================
