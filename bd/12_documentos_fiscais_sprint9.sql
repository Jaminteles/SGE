-- =============================================================================
-- 12_documentos_fiscais_sprint9.sql
-- Sprint 9 - Fase 4 (Compras e Documentos): M07 - Documentos Fiscais
-- (RF-043 a RF-050).
--
-- Executar como gestao_owner, depois de 01 a 11:
--   psql -U gestao_owner -h localhost -d gestao_empresarial -f 12_documentos_fiscais_sprint9.sql
-- Idempotente: pode ser reexecutado.
--
-- O que 02/03 ja entregavam: as tabelas (documento_fiscal, documento_fiscal_item,
-- documento), a RLS por empresa, a auditoria do cabecalho e o indice unico da
-- chave de acesso. Este script fecha o que faltava para o modulo ser confiavel:
--   1. RN-010 - trilha de auditoria tambem nos itens
--   2. RN-001 - referencias presas a mesma empresa (FK composta)
--   3. RF-044 / RF-050 - de onde o documento veio, quem o trouxe e quando
--   4. RF-045 - o documento processado fecha: itens consistentes e totais que
--                somam, conferidos no commit
--   5. RF-046 - duplicidade detectada no modelo, nao na aplicacao
--   6. RF-049 - maquina de estados do processamento, tentativas e imutabilidade
--                do XML recebido
--   7. RF-047 - vinculo com fornecedor, pedido, produto, estoque e financeiro,
--                sem gerar mercadoria nem dinheiro em duplicidade (RN-004)
--   8. RF-048 / RF-049 - pendencias como visao do modelo
--
-- Decisao estrutural, e ela e diferente das sprints anteriores: o documento
-- fiscal **nao e um fato nosso**. Pedido, recebimento e titulo nascem aqui e por
-- isso o banco os calcula; a nota nasce no emitente e passou pela SEFAZ. Os
-- valores dela, portanto, sao *informados* -- o banco nao os recalcula a partir
-- dos itens, ele exige que os dois fechem. Recalcular seria reescrever um
-- documento de terceiro para que ele parecesse correto, e a divergencia entre a
-- soma dos itens e o total da nota e exatamente o que precisa aparecer.
--
-- A segunda decisao: a nota nao entra mercadoria por conta propria quando existe
-- recebimento. Quem tem pedido e conferencia (M06) ja deu entrada no estoque e
-- gerou o titulo; a nota, nesse caso, e a prova fiscal e se vincula. Sem pedido,
-- a nota e o fato de entrada e ela mesma produz os dois efeitos -- uma vez.
-- =============================================================================
SET search_path = gestao, public;

-- -----------------------------------------------------------------------------
-- 1. RN-010: auditoria dos itens
--
-- `documento_fiscal` ja e auditado desde 03; os itens, nao. E no item que estao
-- o produto vinculado, a quantidade e o tributo -- o que decide quanto entrou no
-- estoque e quanto se credita de imposto.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    DROP TRIGGER IF EXISTS trg_documento_fiscal_item_auditoria ON gestao.documento_fiscal_item;
    CREATE TRIGGER trg_documento_fiscal_item_auditoria
        AFTER INSERT OR UPDATE OR DELETE ON gestao.documento_fiscal_item
        FOR EACH ROW EXECUTE FUNCTION gestao.fn_auditoria_generica();
END $$;

-- -----------------------------------------------------------------------------
-- 2. RN-001: referencia cruzada entre empresas
--
-- Mesma tecnica de 06 a 11: chave candidata (empresa_id, id) no destino e FK
-- composta (empresa_id, <coluna>) na origem. A verificacao de FK roda no
-- sistema, sem RLS -- sem a coluna de empresa na chave, a nota da empresa A
-- poderia apontar para o pedido, o produto ou o parceiro da empresa B.
--
-- `titulo.documento_fiscal_id`, `recebimento.documento_fiscal_id` e
-- `movimento_estoque.documento_fiscal_id` entram aqui, e nao em 08/09/11: e
-- nesta sprint que as tres colunas passam a ser preenchidas (RF-047).
-- -----------------------------------------------------------------------------
-- 2.1 Chave candidata (empresa_id, id) nas tabelas referenciadas aqui.
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'documento_fiscal','documento_fiscal_item','documento',
        'filial','parceiro','produto','pedido_compra'
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
-- comportamento correto -- uma nota nao deve perder em silencio o emitente, o
-- pedido que ela fatura nem o documento de que e duplicata.
DO $$
DECLARE
    r record;
    c record;
BEGIN
    FOR r IN
        SELECT * FROM (VALUES
            ('documento_fiscal',      'filial_id',                'filial',          'RESTRICT'),
            ('documento_fiscal',      'emitente_parceiro_id',     'parceiro',        'RESTRICT'),
            ('documento_fiscal',      'destinatario_parceiro_id', 'parceiro',        'RESTRICT'),
            ('documento_fiscal',      'pedido_compra_id',         'pedido_compra',   'RESTRICT'),
            ('documento_fiscal',      'duplicado_de_id',          'documento_fiscal','RESTRICT'),
            ('documento_fiscal_item', 'documento_fiscal_id',      'documento_fiscal','CASCADE'),
            ('documento_fiscal_item', 'produto_id',               'produto',         'RESTRICT'),
            ('titulo',                'documento_fiscal_id',      'documento_fiscal','RESTRICT'),
            ('recebimento',           'documento_fiscal_id',      'documento_fiscal','RESTRICT'),
            ('movimento_estoque',     'documento_fiscal_id',      'documento_fiscal','RESTRICT')
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
-- 3. RF-044 / RF-050: de onde o documento veio, quem o trouxe e quando
--
-- `origem` (UPLOAD_MANUAL, COLETA_AUTOMATICA, API, EMAIL, WEBHOOK) ja existia,
-- mas nao havia como saber *qual* coleta trouxe a nota nem quem a importou. As
-- tres colunas abaixo fecham isso:
--
--   criado_por        quem importou -- a trilha registra a mudanca, o documento
--                     responde a pergunta sem precisar dela;
--   origem_referencia identificador do lote/mensagem na origem. E tambem a
--                     chave de idempotencia da coleta (RF-050): o coletor que
--                     reenvia o mesmo item nao cria um segundo documento;
--   coletado_em       quando a origem entregou -- diferente de `criado_em`, que
--                     e quando a API gravou.
-- -----------------------------------------------------------------------------
ALTER TABLE documento_fiscal ADD COLUMN IF NOT EXISTS criado_por        uuid REFERENCES usuario(id) ON DELETE SET NULL;
ALTER TABLE documento_fiscal ADD COLUMN IF NOT EXISTS origem_referencia varchar(120);
ALTER TABLE documento_fiscal ADD COLUMN IF NOT EXISTS coletado_em       timestamptz;

COMMENT ON COLUMN documento_fiscal.criado_por IS
    'RF-044 - usuario (ou integracao) que trouxe o documento para dentro.';
COMMENT ON COLUMN documento_fiscal.origem_referencia IS
    'RF-050 - identificador do documento na origem; chave de idempotencia da coleta automatica.';
COMMENT ON COLUMN documento_fiscal.coletado_em IS
    'RF-050 - quando a origem entregou o documento, se diferente da gravacao.';

-- Idempotencia da coleta: a mesma referencia da mesma origem nao entra duas
-- vezes. Duplicatas reconhecidas ficam de fora -- elas sao, por definicao, uma
-- segunda chegada do mesmo documento (secao 5).
CREATE UNIQUE INDEX IF NOT EXISTS ux_documento_fiscal_origem_referencia
    ON documento_fiscal (empresa_id, origem, origem_referencia)
    WHERE origem_referencia IS NOT NULL AND status <> 'DUPLICADO';

-- -----------------------------------------------------------------------------
-- 4. RF-045: o documento processado fecha
--
-- Duas regras, e nenhuma delas recalcula a nota:
--
--   4.1 (por linha, imediata)  quantidade e valor unitario positivos, sequencia
--       coerente e valor_total da linha compativel com quantidade * unitario
--       - desconto + frete;
--   4.2 (por documento, no commit) a soma das linhas fecha com valor_produtos, e
--       um documento PROCESSADO tem ao menos uma linha.
--
-- A tolerancia existe porque o XML traz valores ja arredondados pelo emitente:
-- centavos de arredondamento por linha sao normais, diferenca real nao e. Ela
-- cresce com o numero de itens (um centavo por linha) porque e assim que o erro
-- de arredondamento se acumula.
--
-- Documento que nao fecha nao e recusado no INSERT: ele e gravado com status
-- ERRO e a mensagem em `erro_processamento` (RF-049) -- sem itens. Recusar
-- perderia o registro de que a nota chegou, que e justamente o que RF-049 pede
-- para controlar. As regras abaixo valem, portanto, para o documento que se
-- declara PROCESSADO.
-- -----------------------------------------------------------------------------

-- 4.1 BEFORE do item: janela de edicao e consistencia da linha.
--
-- A janela: item so muda enquanto o documento esta em RECEBIDO ou PROCESSANDO --
-- e a janela do processamento, que o reprocessamento reabre. Depois disso a
-- unica coluna que ainda muda e `produto_id`, porque associar o codigo do
-- fornecedor ao nosso item de catalogo e trabalho posterior (RF-047) -- e ela
-- congela quando a nota ja deu entrada no estoque, senao o vinculo que produziu
-- o movimento passaria a ser outro.
CREATE OR REPLACE FUNCTION fn_prepara_documento_fiscal_item() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_doc       record;
    v_esperado  dom_valor;
    v_tolerancia numeric(18,2) := 0.02;
BEGIN
    SELECT d.id, d.numero, d.status, d.gerou_estoque
      INTO v_doc
      FROM documento_fiscal d
     WHERE d.id = coalesce(NEW.documento_fiscal_id, OLD.documento_fiscal_id);

    -- O documento pode estar sendo removido na mesma transacao (itens caem por
    -- CASCADE): nao ha janela a conferir.
    IF NOT FOUND THEN
        RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    IF TG_OP = 'UPDATE' AND v_doc.status NOT IN ('RECEBIDO', 'PROCESSANDO') THEN
        IF (NEW.empresa_id, NEW.documento_fiscal_id, NEW.sequencia, NEW.codigo_produto_origem,
            NEW.descricao, NEW.ncm, NEW.cest, NEW.cfop, NEW.unidade, NEW.quantidade,
            NEW.valor_unitario, NEW.valor_desconto, NEW.valor_frete, NEW.valor_total,
            NEW.cst_icms, NEW.base_calculo_icms, NEW.aliquota_icms, NEW.valor_icms,
            NEW.valor_icms_st, NEW.valor_ipi, NEW.valor_pis, NEW.valor_cofins)
           IS DISTINCT FROM
           (OLD.empresa_id, OLD.documento_fiscal_id, OLD.sequencia, OLD.codigo_produto_origem,
            OLD.descricao, OLD.ncm, OLD.cest, OLD.cfop, OLD.unidade, OLD.quantidade,
            OLD.valor_unitario, OLD.valor_desconto, OLD.valor_frete, OLD.valor_total,
            OLD.cst_icms, OLD.base_calculo_icms, OLD.aliquota_icms, OLD.valor_icms,
            OLD.valor_icms_st, OLD.valor_ipi, OLD.valor_pis, OLD.valor_cofins) THEN
            RAISE EXCEPTION
                'O item % do documento % so aceita o vinculo com o produto: o documento esta % (RF-045/RF-049).',
                OLD.sequencia, v_doc.numero, v_doc.status;
        END IF;

        IF v_doc.gerou_estoque AND NEW.produto_id IS DISTINCT FROM OLD.produto_id THEN
            RAISE EXCEPTION
                'O item % do documento % ja deu entrada no estoque: o produto vinculado nao muda (RN-004).',
                OLD.sequencia, v_doc.numero;
        END IF;

        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        IF v_doc.status NOT IN ('RECEBIDO', 'PROCESSANDO') THEN
            RAISE EXCEPTION
                'O item % nao pode ser removido: o documento % esta % (RF-049).',
                OLD.sequencia, v_doc.numero, v_doc.status;
        END IF;
        RETURN OLD;
    END IF;

    IF NEW.sequencia IS NULL OR NEW.sequencia < 1 THEN
        RAISE EXCEPTION 'A sequencia do item do documento % deve ser positiva (RF-045).', v_doc.numero;
    END IF;
    IF NEW.quantidade <= 0 THEN
        RAISE EXCEPTION 'O item % do documento % tem quantidade nao positiva (RF-045).',
            NEW.sequencia, v_doc.numero;
    END IF;
    IF NEW.valor_unitario < 0 OR NEW.valor_desconto < 0 OR NEW.valor_frete < 0 THEN
        RAISE EXCEPTION 'O item % do documento % tem valor negativo (RF-045).',
            NEW.sequencia, v_doc.numero;
    END IF;

    v_esperado := round(NEW.quantidade * NEW.valor_unitario, 2)
                  - NEW.valor_desconto + NEW.valor_frete;
    IF abs(NEW.valor_total - v_esperado) > v_tolerancia THEN
        RAISE EXCEPTION
            'O item % do documento % informa total % e a composicao da linha da % (RF-045).',
            NEW.sequencia, v_doc.numero, NEW.valor_total, v_esperado;
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_prepara_documento_fiscal_item() IS
    'RF-045/RF-049 - consistencia da linha do documento e janela em que ela ainda muda.';

DROP TRIGGER IF EXISTS trg_prepara_documento_fiscal_item ON documento_fiscal_item;
CREATE TRIGGER trg_prepara_documento_fiscal_item
    BEFORE INSERT OR UPDATE OR DELETE ON documento_fiscal_item
    FOR EACH ROW EXECUTE FUNCTION fn_prepara_documento_fiscal_item();

-- 4.2 A soma das linhas fecha com o total dos produtos -- conferido no commit.
--
-- Constraint trigger DEFERRABLE INITIALLY DEFERRED, como as parcelas do titulo
-- (09) e as partidas dobradas (03), e pela mesma razao: cabecalho e itens nascem
-- em INSERTs distintos e a regra e sobre o conjunto.
CREATE OR REPLACE FUNCTION fn_confere_itens_documento_fiscal(p_documento_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
    v_doc        record;
    v_soma       dom_valor;
    v_itens      int;
    v_tolerancia numeric(18,2);
BEGIN
    SELECT d.numero, d.status, d.valor_produtos, d.valor_desconto, d.valor_frete
      INTO v_doc
      FROM documento_fiscal d
     WHERE d.id = p_documento_id;

    -- Fora de PROCESSADO nao ha o que conferir: RECEBIDO e PROCESSANDO sao o
    -- documento em transito, ERRO e o que nao fechou (e por isso esta em ERRO),
    -- e DUPLICADO/CANCELADO/DENEGADO nao produzem efeito nenhum.
    IF NOT FOUND OR v_doc.status <> 'PROCESSADO' THEN
        RETURN;
    END IF;

    SELECT coalesce(sum(i.valor_total - i.valor_frete + i.valor_desconto), 0), count(*)
      INTO v_soma, v_itens
      FROM documento_fiscal_item i
     WHERE i.documento_fiscal_id = p_documento_id;

    IF v_itens = 0 THEN
        RAISE EXCEPTION 'O documento % processado precisa de ao menos um item (RF-045).', v_doc.numero;
    END IF;

    v_tolerancia := 0.01 * v_itens + 0.01;
    IF abs(v_soma - v_doc.valor_produtos) > v_tolerancia THEN
        RAISE EXCEPTION
            'Os itens do documento % somam % e o documento informa % em produtos (RF-045).',
            v_doc.numero, v_soma, v_doc.valor_produtos;
    END IF;
END;
$$;

COMMENT ON FUNCTION fn_confere_itens_documento_fiscal(uuid) IS
    'RF-045 - os itens de um documento processado somam o valor de produtos informado nele.';

-- Duas funcoes de gatilho, e nao uma compartilhada: `NEW` tem tipos diferentes
-- em cada tabela. A conferencia em si vive num lugar unico, acima.
CREATE OR REPLACE FUNCTION fn_documento_fiscal_confere_itens() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM fn_confere_itens_documento_fiscal(NEW.id);
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION fn_documento_fiscal_item_confere() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM fn_confere_itens_documento_fiscal(OLD.documento_fiscal_id);
        RETURN NULL;
    END IF;

    PERFORM fn_confere_itens_documento_fiscal(NEW.documento_fiscal_id);
    IF TG_OP = 'UPDATE' AND OLD.documento_fiscal_id <> NEW.documento_fiscal_id THEN
        PERFORM fn_confere_itens_documento_fiscal(OLD.documento_fiscal_id);
    END IF;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_documento_fiscal_itens_somam ON documento_fiscal;
CREATE CONSTRAINT TRIGGER trg_documento_fiscal_itens_somam
    AFTER INSERT OR UPDATE ON documento_fiscal
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION fn_documento_fiscal_confere_itens();

DROP TRIGGER IF EXISTS trg_documento_fiscal_item_soma ON documento_fiscal_item;
CREATE CONSTRAINT TRIGGER trg_documento_fiscal_item_soma
    AFTER INSERT OR UPDATE OR DELETE ON documento_fiscal_item
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION fn_documento_fiscal_item_confere();

-- -----------------------------------------------------------------------------
-- 5. RF-046: duplicidade detectada no modelo
--
-- Tres identidades, em ordem de forca:
--
--   xml_hash      o mesmo arquivo, byte a byte. Reenvio -- do operador que clicou
--                 duas vezes ou do coletor que repetiu o lote;
--   chave_acesso  a mesma nota (02 ja garantia isso). Chave igual com conteudo
--                 diferente e outra coisa: nota reemitida ou arquivo adulterado,
--                 e quem decide e uma pessoa;
--   numero+serie+emitente+modelo  para o que nao tem chave (NFS-e municipal,
--                 recibo): e a identidade que o documento tem.
--
-- Os tres indices excluem `status = 'DUPLICADO'`, e e essa exclusao que da a
-- semantica do modulo: a duplicata *convive* com o original, marcada como tal e
-- apontando para ele em `duplicado_de_id`. Recusar a gravacao esconderia a
-- segunda chegada, que e justamente o que se quer ver.
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS ux_documento_fiscal_xml_hash
    ON documento_fiscal (empresa_id, xml_hash)
    WHERE xml_hash IS NOT NULL AND status <> 'DUPLICADO';

CREATE UNIQUE INDEX IF NOT EXISTS ux_documento_fiscal_identidade
    ON documento_fiscal (empresa_id, modelo, numero, coalesce(serie, ''), coalesce(emitente_cnpj_cpf, ''))
    WHERE chave_acesso IS NULL AND status <> 'DUPLICADO';

CREATE OR REPLACE FUNCTION fn_valida_duplicidade_documento_fiscal() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_original record;
BEGIN
    IF NEW.status = 'DUPLICADO' THEN
        IF NEW.duplicado_de_id IS NULL THEN
            RAISE EXCEPTION
                'Documento marcado como duplicado precisa apontar o original em duplicado_de_id (RF-046).';
        END IF;
        IF NEW.duplicado_de_id = NEW.id THEN
            RAISE EXCEPTION 'Um documento nao e duplicata de si mesmo (RF-046).';
        END IF;

        SELECT d.status, d.duplicado_de_id INTO v_original
          FROM documento_fiscal d WHERE d.id = NEW.duplicado_de_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'O original apontado pela duplicata nao existe nesta empresa (RF-046).';
        END IF;
        -- Cadeia de duplicatas: a segunda copia aponta para o original, nao para
        -- a primeira copia -- senao "qual e a nota de verdade" depende de andar
        -- a cadeia inteira.
        IF v_original.status = 'DUPLICADO' THEN
            RAISE EXCEPTION
                'A duplicata deve apontar o documento original, e nao outra duplicata (RF-046).';
        END IF;

    ELSIF NEW.duplicado_de_id IS NOT NULL THEN
        RAISE EXCEPTION
            'duplicado_de_id so existe em documento com status DUPLICADO (RF-046).';
    END IF;

    -- A duplicata nao produz efeito: ela existe para ser vista, nao para entrar
    -- no estoque nem gerar titulo.
    IF NEW.status = 'DUPLICADO' AND (NEW.gerou_estoque OR NEW.gerou_financeiro) THEN
        RAISE EXCEPTION 'Documento duplicado nao gera estoque nem financeiro (RF-046/RN-004).';
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_valida_duplicidade_documento_fiscal() IS
    'RF-046 - a duplicata aponta o original, nao encadeia e nao produz efeito.';

DROP TRIGGER IF EXISTS trg_valida_duplicidade_documento_fiscal ON documento_fiscal;
CREATE TRIGGER trg_valida_duplicidade_documento_fiscal
    BEFORE INSERT OR UPDATE ON documento_fiscal
    FOR EACH ROW EXECUTE FUNCTION fn_valida_duplicidade_documento_fiscal();

-- -----------------------------------------------------------------------------
-- 6. RF-049: maquina de estados do processamento
--
-- O que o modulo controla nao e o conteudo da nota -- e o que aconteceu com ela
-- desde que chegou. Transicoes validas:
--
--   RECEBIDO     -> PROCESSANDO, PROCESSADO, ERRO, DUPLICADO, CANCELADO
--   PROCESSANDO  -> PROCESSADO, ERRO
--   ERRO         -> PROCESSANDO, CANCELADO
--   PROCESSADO   -> CANCELADO, DENEGADO
--   DUPLICADO    -> CANCELADO
--   CANCELADO / DENEGADO -> terminais
--
-- Duas garantias andam com ela:
--   - o XML recebido e imutavel. Trocar o conteudo de um documento ja gravado
--     nao e reprocessar: e substituir a prova. Reprocessar e ler outra vez o
--     mesmo XML;
--   - `tentativas_processamento` nunca retrocede, e `processado_em` /
--     `erro_processamento` sao consequencia do status, nao campos livres.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_valida_documento_fiscal() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status NOT IN ('RECEBIDO', 'PROCESSANDO', 'PROCESSADO', 'ERRO', 'DUPLICADO') THEN
            RAISE EXCEPTION
                'Documento fiscal nao nasce % (RF-049).', NEW.status;
        END IF;
    ELSE
        IF NEW.status <> OLD.status THEN
            IF OLD.status IN ('CANCELADO', 'DENEGADO') THEN
                RAISE EXCEPTION
                    'O documento % esta % e nao muda mais de situacao (RF-049).', OLD.numero, OLD.status;
            END IF;
            IF NOT (
                (OLD.status = 'RECEBIDO'    AND NEW.status IN ('PROCESSANDO','PROCESSADO','ERRO','DUPLICADO','CANCELADO'))
             OR (OLD.status = 'PROCESSANDO' AND NEW.status IN ('PROCESSADO','ERRO'))
             OR (OLD.status = 'ERRO'        AND NEW.status IN ('PROCESSANDO','CANCELADO'))
             OR (OLD.status = 'PROCESSADO'  AND NEW.status IN ('CANCELADO','DENEGADO'))
             OR (OLD.status = 'DUPLICADO'   AND NEW.status = 'CANCELADO')
            ) THEN
                RAISE EXCEPTION 'Transicao invalida do documento %: % -> % (RF-049).',
                    OLD.numero, OLD.status, NEW.status;
            END IF;
        END IF;

        -- O XML e a identidade fiscal: nenhum dos dois se reescreve.
        IF (NEW.xml_conteudo, NEW.xml_hash) IS DISTINCT FROM (OLD.xml_conteudo, OLD.xml_hash)
           AND OLD.xml_hash IS NOT NULL THEN
            RAISE EXCEPTION
                'O XML do documento % nao pode ser substituido: reprocesse o que foi recebido (RF-049).',
                OLD.numero;
        END IF;
        IF NEW.chave_acesso IS DISTINCT FROM OLD.chave_acesso AND OLD.chave_acesso IS NOT NULL THEN
            RAISE EXCEPTION 'A chave de acesso do documento % nao muda (RF-045).', OLD.numero;
        END IF;
        IF NEW.tentativas_processamento < OLD.tentativas_processamento THEN
            RAISE EXCEPTION 'O contador de tentativas do documento % nao retrocede (RF-049).',
                OLD.numero;
        END IF;
    END IF;

    -- Consequencias do status, escritas aqui para que nao dependam do chamador.
    IF NEW.status = 'PROCESSADO' THEN
        NEW.processado_em := coalesce(NEW.processado_em, now());
        NEW.erro_processamento := NULL;
        IF NEW.emitente_cnpj_cpf IS NULL OR NEW.valor_total <= 0 THEN
            RAISE EXCEPTION
                'Documento % processado exige emitente identificado e valor total positivo (RF-045).',
                NEW.numero;
        END IF;
    ELSIF NEW.status = 'ERRO' AND coalesce(NEW.erro_processamento, '') = '' THEN
        RAISE EXCEPTION 'Documento % em ERRO exige a mensagem em erro_processamento (RF-049).',
            NEW.numero;
    END IF;

    -- A data de emissao vem de fora: nota do futuro e sinal de arquivo errado.
    IF NEW.data_emissao > now() + interval '1 day' THEN
        RAISE EXCEPTION 'A data de emissao do documento % esta no futuro (RF-045).', NEW.numero;
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_valida_documento_fiscal() IS
    'RF-049 - transicoes do processamento, imutabilidade do XML e consequencias do status.';

DROP TRIGGER IF EXISTS trg_valida_documento_fiscal ON documento_fiscal;
CREATE TRIGGER trg_valida_documento_fiscal
    BEFORE INSERT OR UPDATE ON documento_fiscal
    FOR EACH ROW EXECUTE FUNCTION fn_valida_documento_fiscal();

-- -----------------------------------------------------------------------------
-- 7. RF-047: vinculo com estoque e financeiro, sem duplicidade
--
-- RN-004 outra vez, e agora com duas portas para o mesmo efeito -- e por isso a
-- regra e mais forte que em 11:
--
--   a) com pedido de compra, quem da entrada e o recebimento (M06). A nota se
--      vincula ao recebimento e ao pedido, e nao gera nada;
--   b) sem pedido, a nota e o fato de entrada e produz os dois efeitos.
--
-- Se as duas portas se abrissem, a mesma mercadoria entraria duas vezes e a
-- mesma compra seria paga duas vezes. Os indices unicos impedem o replay da
-- mesma linha; os guardas abaixo impedem a segunda porta.
--
-- Granularidade dos indices, como em 11: no estoque, `origem_id` e o **item** do
-- documento (uma entrada por linha); no financeiro, e o **documento** (um titulo
-- por nota).
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS ux_movimento_origem_documento_fiscal
    ON movimento_estoque (origem_id) WHERE origem_tipo = 'DOCUMENTO_FISCAL';

CREATE UNIQUE INDEX IF NOT EXISTS ux_titulo_origem_documento_fiscal
    ON titulo (empresa_id, origem_id) WHERE origem_tipo = 'DOCUMENTO_FISCAL';

-- 7.1 O documento que tem recebimento nao da entrada por conta propria.
CREATE OR REPLACE FUNCTION fn_valida_efeito_documento_fiscal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = gestao, public AS $$
DECLARE
    v_doc_id  uuid;
    v_doc     record;
    v_coluna  text := CASE TG_TABLE_NAME WHEN 'titulo' THEN 'gerou_financeiro' ELSE 'gerou_estoque' END;
    v_conflito boolean;
BEGIN
    -- No estoque a origem e o item; no financeiro, o documento.
    IF TG_TABLE_NAME = 'movimento_estoque' THEN
        SELECT i.documento_fiscal_id INTO v_doc_id
          FROM documento_fiscal_item i WHERE i.id = NEW.origem_id;
    ELSE
        v_doc_id := NEW.origem_id;
    END IF;

    IF v_doc_id IS NULL THEN
        RAISE EXCEPTION 'Origem DOCUMENTO_FISCAL sem documento correspondente (RF-047).';
    END IF;

    SELECT d.id, d.numero, d.status, d.pedido_compra_id
      INTO v_doc
      FROM documento_fiscal d
     WHERE d.id = v_doc_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Origem DOCUMENTO_FISCAL aponta documento inexistente (RF-047).';
    END IF;
    IF v_doc.status <> 'PROCESSADO' THEN
        RAISE EXCEPTION
            'O documento % esta % e nao gera estoque nem financeiro (RF-047/RF-049).',
            v_doc.numero, v_doc.status;
    END IF;

    -- A outra porta: recebimento que ja produziu o mesmo efeito, do proprio
    -- documento ou do pedido que ele fatura.
    EXECUTE format(
        'SELECT EXISTS (SELECT 1 FROM gestao.recebimento r
                         WHERE r.%I
                           AND (r.documento_fiscal_id = $1
                                OR ($2 IS NOT NULL AND r.pedido_compra_id = $2)))', v_coluna)
       INTO v_conflito
      USING v_doc.id, v_doc.pedido_compra_id;

    IF v_conflito THEN
        RAISE EXCEPTION
            'O recebimento do documento % ja produziu esse efeito: a nota se vincula, nao repete a entrada (RN-004).',
            v_doc.numero;
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_valida_efeito_documento_fiscal() IS
    'RN-004/RF-047 - so o documento processado gera efeito, e nunca o que ja entrou pelo recebimento.';

DROP TRIGGER IF EXISTS trg_valida_movimento_documento_fiscal ON movimento_estoque;
CREATE TRIGGER trg_valida_movimento_documento_fiscal
    BEFORE INSERT ON movimento_estoque
    FOR EACH ROW WHEN (NEW.origem_tipo = 'DOCUMENTO_FISCAL')
    EXECUTE FUNCTION fn_valida_efeito_documento_fiscal();

DROP TRIGGER IF EXISTS trg_valida_titulo_documento_fiscal ON titulo;
CREATE TRIGGER trg_valida_titulo_documento_fiscal
    BEFORE INSERT ON titulo
    FOR EACH ROW WHEN (NEW.origem_tipo = 'DOCUMENTO_FISCAL')
    EXECUTE FUNCTION fn_valida_efeito_documento_fiscal();

-- 7.2 As marcas do documento sao projecao do que existe.
--
-- Elas cobrem as duas portas: o efeito gerado pela propria nota e o gerado pelo
-- recebimento que a referencia. Sem isso, uma nota vinculada a um recebimento
-- apareceria eternamente como "sem efeito" na consulta de pendencias.
CREATE OR REPLACE FUNCTION fn_marca_documento_fiscal_estoque() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = gestao, public AS $$
DECLARE v_doc_id uuid;
BEGIN
    IF NEW.origem_tipo = 'DOCUMENTO_FISCAL' THEN
        SELECT i.documento_fiscal_id INTO v_doc_id
          FROM documento_fiscal_item i WHERE i.id = NEW.origem_id;
    ELSE
        SELECT r.documento_fiscal_id INTO v_doc_id
          FROM recebimento_item ri
          JOIN recebimento r ON r.id = ri.recebimento_id
         WHERE ri.id = NEW.origem_id;
    END IF;

    IF v_doc_id IS NOT NULL THEN
        UPDATE documento_fiscal SET gerou_estoque = true
         WHERE id = v_doc_id AND NOT gerou_estoque;
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_marca_documento_fiscal_estoque ON movimento_estoque;
CREATE TRIGGER trg_marca_documento_fiscal_estoque
    AFTER INSERT ON movimento_estoque
    FOR EACH ROW WHEN (NEW.origem_tipo IN ('DOCUMENTO_FISCAL', 'RECEBIMENTO') AND NEW.origem_id IS NOT NULL)
    EXECUTE FUNCTION fn_marca_documento_fiscal_estoque();

CREATE OR REPLACE FUNCTION fn_marca_documento_fiscal_financeiro() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = gestao, public AS $$
DECLARE v_doc_id uuid;
BEGIN
    IF NEW.origem_tipo = 'DOCUMENTO_FISCAL' THEN
        v_doc_id := NEW.origem_id;
    ELSE
        SELECT r.documento_fiscal_id INTO v_doc_id
          FROM recebimento r WHERE r.id = NEW.origem_id;
    END IF;

    IF v_doc_id IS NOT NULL THEN
        UPDATE documento_fiscal SET gerou_financeiro = true
         WHERE id = v_doc_id AND NOT gerou_financeiro;
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_marca_documento_fiscal_financeiro ON titulo;
CREATE TRIGGER trg_marca_documento_fiscal_financeiro
    AFTER INSERT ON titulo
    FOR EACH ROW WHEN (NEW.origem_tipo IN ('DOCUMENTO_FISCAL', 'RECEBIMENTO') AND NEW.origem_id IS NOT NULL)
    EXECUTE FUNCTION fn_marca_documento_fiscal_financeiro();

-- 7.3 O vinculo com o pedido respeita o fornecedor da nota.
--
-- Vincular a nota ao pedido de outro fornecedor e o erro que faz o historico de
-- precos (RF-042) e o rateio de custo mentirem sobre quem vendeu o que.
CREATE OR REPLACE FUNCTION fn_valida_vinculo_documento_fiscal() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_parceiro uuid;
BEGIN
    IF NEW.pedido_compra_id IS NULL
       OR (TG_OP = 'UPDATE' AND NEW.pedido_compra_id IS NOT DISTINCT FROM OLD.pedido_compra_id) THEN
        RETURN NEW;
    END IF;

    SELECT p.parceiro_id INTO v_parceiro
      FROM pedido_compra p WHERE p.id = NEW.pedido_compra_id;

    IF NEW.emitente_parceiro_id IS NOT NULL AND v_parceiro IS DISTINCT FROM NEW.emitente_parceiro_id THEN
        RAISE EXCEPTION
            'O documento % foi emitido por outro fornecedor que nao o do pedido vinculado (RF-047).',
            NEW.numero;
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_valida_vinculo_documento_fiscal() IS
    'RF-047 - o pedido vinculado a nota e do mesmo fornecedor que a emitiu.';

DROP TRIGGER IF EXISTS trg_valida_vinculo_documento_fiscal ON documento_fiscal;
CREATE TRIGGER trg_valida_vinculo_documento_fiscal
    BEFORE INSERT OR UPDATE ON documento_fiscal
    FOR EACH ROW EXECUTE FUNCTION fn_valida_vinculo_documento_fiscal();

-- -----------------------------------------------------------------------------
-- 8. RF-048 / RF-049: pendencias como visao do modelo
--
-- "O que falta resolver nos documentos que chegaram" e a pergunta que o modulo
-- existe para responder, e ela nao pode depender de quem escreveu o relatorio.
-- Cada coluna `pendencia_*` e uma acao concreta de alguem.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_documento_fiscal_pendencia AS
SELECT d.empresa_id,
       d.id                       AS documento_fiscal_id,
       d.modelo,
       d.numero,
       d.serie,
       d.chave_acesso,
       d.data_emissao,
       d.origem,
       d.status,
       d.emitente_cnpj_cpf,
       d.emitente_nome,
       d.emitente_parceiro_id,
       d.pedido_compra_id,
       d.valor_total,
       d.tentativas_processamento,
       d.erro_processamento,
       d.status = 'ERRO'                                       AS pendencia_processamento,
       d.status = 'PROCESSADO' AND d.emitente_parceiro_id IS NULL
                                                               AS pendencia_fornecedor,
       (SELECT count(*) FROM documento_fiscal_item i
         WHERE i.documento_fiscal_id = d.id AND i.produto_id IS NULL)
                                                               AS itens_sem_produto,
       d.status = 'PROCESSADO' AND NOT d.gerou_estoque         AS pendencia_estoque,
       d.status = 'PROCESSADO' AND NOT d.gerou_financeiro      AS pendencia_financeiro,
       (SELECT count(*) FROM documento d2
         WHERE d2.empresa_id = d.empresa_id
           AND d2.entidade = 'documento_fiscal'
           AND d2.entidade_id = d.id)                          AS anexos
  FROM documento_fiscal d
 WHERE d.status NOT IN ('CANCELADO', 'DENEGADO', 'DUPLICADO');

COMMENT ON VIEW vw_documento_fiscal_pendencia IS
    'RF-047/RF-048/RF-049 - documentos em aberto e o que falta em cada um: processar, vincular, dar entrada, pagar.';

-- -----------------------------------------------------------------------------
-- 9. Privilegios: documento fiscal nao se apaga
--
-- Como a trilha (05), o razao (08) e a baixa (09): o que existe e o cancelamento
-- com status, nao o DELETE. Retirar o privilegio da role da aplicacao e a
-- segunda barreira -- um trigger pode ser desabilitado por quem tem direito
-- sobre a tabela; um GRANT ausente, nao.
--
-- `documento_fiscal_item` mantem DELETE: o reprocessamento reescreve os itens do
-- documento, e a janela em que isso e permitido e controlada pela secao 4.1.
-- -----------------------------------------------------------------------------
DO $$
DECLARE r text;
BEGIN
    FOREACH r IN ARRAY ARRAY['app_gestao', 'sge_api'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE DELETE, TRUNCATE ON gestao.documento_fiscal FROM %I;', r);
            EXECUTE format('GRANT SELECT, INSERT, UPDATE ON gestao.documento_fiscal TO %I;', r);
            EXECUTE format(
                'GRANT SELECT, INSERT, UPDATE, DELETE ON gestao.documento_fiscal_item TO %I;', r);
            EXECUTE format('GRANT SELECT ON gestao.vw_documento_fiscal_pendencia TO %I;', r);
        END IF;
    END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 10. Indices de consulta
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS ix_documento_fiscal_pendente
    ON documento_fiscal (empresa_id, data_emissao DESC)
    WHERE status IN ('RECEBIDO', 'PROCESSANDO', 'ERRO');

CREATE INDEX IF NOT EXISTS ix_documento_fiscal_pedido
    ON documento_fiscal (pedido_compra_id) WHERE pedido_compra_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_doc_fiscal_item_produto
    ON documento_fiscal_item (produto_id, empresa_id) WHERE produto_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_titulo_documento_fiscal
    ON titulo (documento_fiscal_id) WHERE documento_fiscal_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_recebimento_documento_fiscal
    ON recebimento (documento_fiscal_id) WHERE documento_fiscal_id IS NOT NULL;

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
    v_rls      int;
BEGIN
    SELECT count(*) INTO v_triggers
      FROM pg_trigger
     WHERE NOT tgisinternal
       AND tgname IN ('trg_prepara_documento_fiscal_item','trg_documento_fiscal_itens_somam',
                      'trg_documento_fiscal_item_soma','trg_valida_duplicidade_documento_fiscal',
                      'trg_valida_documento_fiscal','trg_valida_movimento_documento_fiscal',
                      'trg_valida_titulo_documento_fiscal','trg_marca_documento_fiscal_estoque',
                      'trg_marca_documento_fiscal_financeiro','trg_valida_vinculo_documento_fiscal',
                      'trg_documento_fiscal_item_auditoria');
    IF v_triggers < 11 THEN
        RAISE WARNING 'regras do M07 incompletas (% de 11)', v_triggers; v_falhas := v_falhas + 1;
    END IF;

    SELECT count(*) INTO v_fks
      FROM pg_constraint
     WHERE contype = 'f'
       AND conname LIKE 'fk\_%\_tenant'
       AND conrelid IN ('gestao.documento_fiscal'::regclass,
                        'gestao.documento_fiscal_item'::regclass);
    IF v_fks < 7 THEN
        RAISE WARNING 'FKs multiempresa do M07 incompletas (% de 7)', v_fks; v_falhas := v_falhas + 1;
    END IF;

    SELECT count(*) INTO v_indices
      FROM pg_indexes
     WHERE schemaname = 'gestao'
       AND indexname IN ('ux_documento_fiscal_xml_hash','ux_documento_fiscal_identidade',
                         'ux_documento_fiscal_origem_referencia',
                         'ux_movimento_origem_documento_fiscal','ux_titulo_origem_documento_fiscal');
    IF v_indices < 5 THEN
        RAISE WARNING 'protecao contra duplicidade do M07 incompleta (% de 5) - RF-046/RN-004', v_indices;
        v_falhas := v_falhas + 1;
    END IF;

    SELECT count(*) INTO v_gravavel
      FROM information_schema.table_privileges
     WHERE table_schema = 'gestao'
       AND table_name = 'documento_fiscal'
       AND grantee IN ('app_gestao','sge_api')
       AND privilege_type = 'DELETE';
    IF v_gravavel > 0 THEN
        RAISE WARNING 'documento fiscal ainda removivel pela aplicacao (% privilegios)', v_gravavel;
        v_falhas := v_falhas + 1;
    END IF;

    SELECT count(*) INTO v_rls
      FROM pg_class
     WHERE relnamespace = 'gestao'::regnamespace
       AND relname IN ('documento_fiscal','documento_fiscal_item','documento')
       AND relrowsecurity AND relforcerowsecurity;
    IF v_rls < 3 THEN
        RAISE WARNING 'RLS ausente em tabela do M07 (% de 3) - rode bd/03', v_rls;
        v_falhas := v_falhas + 1;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_views
                    WHERE schemaname = 'gestao' AND viewname = 'vw_documento_fiscal_pendencia') THEN
        RAISE WARNING 'consulta de pendencias ausente (RF-049)'; v_falhas := v_falhas + 1;
    END IF;

    IF v_falhas = 0 THEN
        RAISE NOTICE 'M07 - Documentos Fiscais: ajustes aplicados com sucesso.';
    END IF;
END $$;
