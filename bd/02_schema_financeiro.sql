-- =============================================================================
-- SISTEMA INTEGRADO DE GESTAO EMPRESARIAL E FINANCEIRA
-- Parte 2/3: Compras, documentos fiscais, contas a pagar/receber,
--            bancos/pagamentos e conciliacao bancaria
-- =============================================================================
SET search_path = gestao, public;

-- =============================================================================
-- M06 - COMPRAS                                       (RF-036 a RF-042)
-- =============================================================================

CREATE TABLE pedido_compra (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id              uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    filial_id               uuid REFERENCES filial(id) ON DELETE SET NULL,
    numero                  varchar(30) NOT NULL,
    parceiro_id             uuid NOT NULL REFERENCES parceiro(id) ON DELETE RESTRICT,
    solicitante_id          uuid REFERENCES usuario(id) ON DELETE SET NULL,
    comprador_id            uuid REFERENCES funcionario(id) ON DELETE SET NULL,
    data_pedido             date NOT NULL DEFAULT current_date,
    data_previsao_entrega   date,
    condicao_pagamento_id   uuid REFERENCES condicao_pagamento(id) ON DELETE SET NULL,
    forma_pagamento_id      uuid REFERENCES forma_pagamento(id)    ON DELETE SET NULL,
    centro_custo_id         uuid REFERENCES centro_custo(id) ON DELETE SET NULL,
    categoria_financeira_id uuid REFERENCES categoria_financeira(id) ON DELETE SET NULL,
    valor_produtos          dom_valor NOT NULL DEFAULT 0,
    valor_desconto          dom_valor NOT NULL DEFAULT 0,
    valor_frete             dom_valor NOT NULL DEFAULT 0,
    valor_seguro            dom_valor NOT NULL DEFAULT 0,
    valor_outras_despesas   dom_valor NOT NULL DEFAULT 0,
    valor_total             dom_valor NOT NULL DEFAULT 0,
    status                  enum_status_pedido_compra NOT NULL DEFAULT 'RASCUNHO',
    status_aprovacao        enum_status_aprovacao NOT NULL DEFAULT 'NAO_REQUERIDA',
    observacao              text,
    cancelado_em            timestamptz,
    motivo_cancelamento     text,
    criado_por              uuid REFERENCES usuario(id) ON DELETE SET NULL,
    criado_em               timestamptz NOT NULL DEFAULT now(),
    atualizado_em           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_pedido_compra_numero UNIQUE (empresa_id, numero),
    CONSTRAINT ck_pedido_compra_valores CHECK (valor_total >= 0 AND valor_desconto >= 0)
);
CREATE INDEX ix_pedido_compra_empresa ON pedido_compra (empresa_id, status);
CREATE INDEX ix_pedido_compra_parceiro ON pedido_compra (parceiro_id, data_pedido DESC);

CREATE TABLE pedido_compra_item (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id          uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    pedido_compra_id    uuid NOT NULL REFERENCES pedido_compra(id) ON DELETE CASCADE,
    sequencia           smallint NOT NULL,
    produto_id          uuid REFERENCES produto(id) ON DELETE RESTRICT,
    descricao           varchar(255) NOT NULL,
    quantidade          dom_quantidade NOT NULL,
    quantidade_recebida dom_quantidade NOT NULL DEFAULT 0,
    preco_unitario      dom_valor_unit NOT NULL,
    valor_desconto      dom_valor NOT NULL DEFAULT 0,
    valor_frete_rateado dom_valor NOT NULL DEFAULT 0,
    valor_total         dom_valor NOT NULL,
    centro_custo_id     uuid REFERENCES centro_custo(id) ON DELETE SET NULL,
    local_estoque_id    uuid REFERENCES local_estoque(id) ON DELETE SET NULL,
    observacao          text,
    CONSTRAINT uq_pedido_compra_item UNIQUE (pedido_compra_id, sequencia),
    CONSTRAINT ck_pedido_item_qtd CHECK (quantidade > 0 AND quantidade_recebida >= 0),
    CONSTRAINT ck_pedido_item_recebido CHECK (quantidade_recebida <= quantidade)
);
CREATE INDEX ix_pedido_compra_item_pedido ON pedido_compra_item (pedido_compra_id);

-- Recebimento total ou parcial (RF-039 / RF-040)
CREATE TABLE recebimento (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id          uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    filial_id           uuid REFERENCES filial(id) ON DELETE SET NULL,
    pedido_compra_id    uuid REFERENCES pedido_compra(id) ON DELETE RESTRICT,
    documento_fiscal_id uuid,   -- FK adicionada apos documento_fiscal
    numero              varchar(30) NOT NULL,
    data_recebimento    timestamptz NOT NULL DEFAULT now(),
    local_estoque_id    uuid REFERENCES local_estoque(id) ON DELETE SET NULL,
    conferente_id       uuid REFERENCES usuario(id) ON DELETE SET NULL,
    possui_divergencia  boolean NOT NULL DEFAULT false,
    gerou_estoque       boolean NOT NULL DEFAULT false,
    gerou_financeiro    boolean NOT NULL DEFAULT false,
    observacao          text,
    criado_em           timestamptz NOT NULL DEFAULT now(),
    atualizado_em       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_recebimento_numero UNIQUE (empresa_id, numero)
);
CREATE INDEX ix_recebimento_pedido ON recebimento (pedido_compra_id);

CREATE TABLE recebimento_item (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id              uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    recebimento_id          uuid NOT NULL REFERENCES recebimento(id) ON DELETE CASCADE,
    pedido_compra_item_id   uuid REFERENCES pedido_compra_item(id) ON DELETE RESTRICT,
    produto_id              uuid REFERENCES produto(id) ON DELETE RESTRICT,
    quantidade_pedida       dom_quantidade,
    quantidade_recebida     dom_quantidade NOT NULL,
    preco_pedido            dom_valor_unit,
    preco_documento         dom_valor_unit,
    divergencia_quantidade  dom_quantidade GENERATED ALWAYS AS (coalesce(quantidade_recebida,0) - coalesce(quantidade_pedida,0)) STORED,
    tipo_divergencia        varchar(40),   -- QUANTIDADE, PRECO, AMBOS, NENHUMA
    aceito                  boolean NOT NULL DEFAULT true,
    observacao              text,
    CONSTRAINT ck_recebimento_item_qtd CHECK (quantidade_recebida > 0)
);
CREATE INDEX ix_recebimento_item_receb ON recebimento_item (recebimento_id);

-- =============================================================================
-- M07 - DOCUMENTOS FISCAIS                            (RF-043 a RF-050)
-- =============================================================================

CREATE TABLE documento_fiscal (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id              uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    filial_id               uuid REFERENCES filial(id) ON DELETE SET NULL,
    modelo                  enum_modelo_doc_fiscal NOT NULL DEFAULT 'NFE',
    chave_acesso            varchar(44),
    numero                  varchar(20) NOT NULL,
    serie                   varchar(5),
    tipo_operacao           char(1),           -- 0=entrada, 1=saida
    natureza_operacao       varchar(120),
    data_emissao            timestamptz NOT NULL,
    data_entrada_saida      timestamptz,
    -- Emitente / destinatario
    emitente_parceiro_id    uuid REFERENCES parceiro(id) ON DELETE SET NULL,
    emitente_cnpj_cpf       varchar(14),
    emitente_nome           varchar(255),
    destinatario_parceiro_id uuid REFERENCES parceiro(id) ON DELETE SET NULL,
    destinatario_cnpj_cpf   varchar(14),
    destinatario_nome       varchar(255),
    -- Valores (RF-045)
    valor_produtos          dom_valor NOT NULL DEFAULT 0,
    valor_desconto          dom_valor NOT NULL DEFAULT 0,
    valor_frete             dom_valor NOT NULL DEFAULT 0,
    valor_seguro            dom_valor NOT NULL DEFAULT 0,
    valor_outras_despesas   dom_valor NOT NULL DEFAULT 0,
    valor_total             dom_valor NOT NULL DEFAULT 0,
    valor_icms              dom_valor NOT NULL DEFAULT 0,
    valor_icms_st           dom_valor NOT NULL DEFAULT 0,
    valor_ipi               dom_valor NOT NULL DEFAULT 0,
    valor_pis               dom_valor NOT NULL DEFAULT 0,
    valor_cofins            dom_valor NOT NULL DEFAULT 0,
    valor_iss               dom_valor NOT NULL DEFAULT 0,
    -- Processamento (RF-044 / RF-049)
    origem                  enum_origem_doc_fiscal NOT NULL DEFAULT 'UPLOAD_MANUAL',
    status                  enum_status_doc_fiscal NOT NULL DEFAULT 'RECEBIDO',
    xml_conteudo            text,
    xml_hash                varchar(64),
    xml_storage_url         text,
    danfe_storage_url       text,
    tentativas_processamento smallint NOT NULL DEFAULT 0,
    erro_processamento      text,
    processado_em           timestamptz,
    duplicado_de_id         uuid REFERENCES documento_fiscal(id) ON DELETE SET NULL,
    -- Vinculos (RF-047)
    pedido_compra_id        uuid REFERENCES pedido_compra(id) ON DELETE SET NULL,
    gerou_estoque           boolean NOT NULL DEFAULT false,
    gerou_financeiro        boolean NOT NULL DEFAULT false,
    metadados               jsonb NOT NULL DEFAULT '{}'::jsonb,
    criado_em               timestamptz NOT NULL DEFAULT now(),
    atualizado_em           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_doc_fiscal_chave CHECK (chave_acesso IS NULL OR chave_acesso ~ '^[0-9]{44}$')
);
-- RN-007 / RF-046: chave de acesso unica por empresa
CREATE UNIQUE INDEX ux_documento_fiscal_chave
    ON documento_fiscal (empresa_id, chave_acesso)
    WHERE chave_acesso IS NOT NULL AND status <> 'DUPLICADO';
CREATE INDEX ix_documento_fiscal_status ON documento_fiscal (empresa_id, status);
CREATE INDEX ix_documento_fiscal_emitente ON documento_fiscal (emitente_parceiro_id, data_emissao DESC);
CREATE INDEX ix_documento_fiscal_metadados ON documento_fiscal USING gin (metadados);

ALTER TABLE recebimento
    ADD CONSTRAINT fk_recebimento_documento_fiscal
    FOREIGN KEY (documento_fiscal_id) REFERENCES documento_fiscal(id) ON DELETE SET NULL;
ALTER TABLE movimento_estoque
    ADD CONSTRAINT fk_movimento_documento_fiscal
    FOREIGN KEY (documento_fiscal_id) REFERENCES documento_fiscal(id) ON DELETE SET NULL;

CREATE TABLE documento_fiscal_item (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id              uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    documento_fiscal_id     uuid NOT NULL REFERENCES documento_fiscal(id) ON DELETE CASCADE,
    sequencia               smallint NOT NULL,
    produto_id              uuid REFERENCES produto(id) ON DELETE SET NULL,
    codigo_produto_origem   varchar(60),
    descricao               varchar(255) NOT NULL,
    ncm                     varchar(8),
    cest                    varchar(7),
    cfop                    varchar(4),
    unidade                 varchar(6),
    quantidade              dom_quantidade NOT NULL,
    valor_unitario          dom_valor_unit NOT NULL,
    valor_desconto          dom_valor NOT NULL DEFAULT 0,
    valor_frete             dom_valor NOT NULL DEFAULT 0,
    valor_total             dom_valor NOT NULL,
    cst_icms                varchar(4),
    base_calculo_icms       dom_valor NOT NULL DEFAULT 0,
    aliquota_icms           dom_percentual NOT NULL DEFAULT 0,
    valor_icms              dom_valor NOT NULL DEFAULT 0,
    valor_icms_st           dom_valor NOT NULL DEFAULT 0,
    valor_ipi               dom_valor NOT NULL DEFAULT 0,
    valor_pis               dom_valor NOT NULL DEFAULT 0,
    valor_cofins            dom_valor NOT NULL DEFAULT 0,
    CONSTRAINT uq_documento_fiscal_item UNIQUE (documento_fiscal_id, sequencia)
);
CREATE INDEX ix_doc_fiscal_item_doc ON documento_fiscal_item (documento_fiscal_id);

-- Documentos e anexos genericos (RF-048 / M13)
CREATE TABLE documento (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id          uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    nome_arquivo        varchar(255) NOT NULL,
    tipo_mime           varchar(120),
    tamanho_bytes       bigint,
    hash_sha256         varchar(64),
    storage_provider    varchar(40) NOT NULL DEFAULT 'S3',
    storage_key         text NOT NULL,
    categoria           varchar(60),        -- COMPROVANTE, CONTRATO, DANFE, BOLETO, EXTRATO
    entidade            varchar(60),        -- tabela relacionada
    entidade_id         uuid,
    enviado_por         uuid REFERENCES usuario(id) ON DELETE SET NULL,
    criado_em           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_documento_entidade ON documento (empresa_id, entidade, entidade_id);

ALTER TABLE reembolso_item
    ADD CONSTRAINT fk_reembolso_item_documento
    FOREIGN KEY (documento_id) REFERENCES documento(id) ON DELETE SET NULL;

-- =============================================================================
-- M08 - CONTAS A PAGAR E RECEBER                      (RF-051 a RF-058)
-- =============================================================================
-- Decisao de modelagem: uma unica entidade "titulo" discriminada por tipo
-- (PAGAR / RECEBER). Parcelas, baixas, juros e conciliacao compartilham a mesma
-- estrutura; as views vw_conta_pagar / vw_conta_receber expoem cada visao.

CREATE TABLE recorrencia (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id              uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    descricao               varchar(255) NOT NULL,
    tipo                    enum_tipo_titulo NOT NULL,
    periodicidade           enum_periodicidade NOT NULL,
    dia_vencimento          smallint,
    valor_padrao            dom_valor,
    parceiro_id             uuid REFERENCES parceiro(id) ON DELETE SET NULL,
    categoria_financeira_id uuid REFERENCES categoria_financeira(id) ON DELETE SET NULL,
    centro_custo_id         uuid REFERENCES centro_custo(id) ON DELETE SET NULL,
    data_inicio             date NOT NULL,
    data_fim                date,
    ocorrencias_max         smallint,
    ocorrencias_geradas     smallint NOT NULL DEFAULT 0,
    proxima_geracao         date,
    ativo                   boolean NOT NULL DEFAULT true,
    criado_em               timestamptz NOT NULL DEFAULT now(),
    atualizado_em           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_recorrencia_dia CHECK (dia_vencimento IS NULL OR dia_vencimento BETWEEN 1 AND 31)
);

CREATE TABLE titulo (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id              uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    filial_id               uuid REFERENCES filial(id) ON DELETE SET NULL,
    tipo                    enum_tipo_titulo NOT NULL,
    numero                  varchar(30) NOT NULL,
    documento_referencia    varchar(60),          -- numero da NF, contrato, etc.
    parceiro_id             uuid REFERENCES parceiro(id) ON DELETE RESTRICT,
    funcionario_id          uuid REFERENCES funcionario(id) ON DELETE RESTRICT,
    descricao               varchar(255) NOT NULL,
    data_emissao            date NOT NULL DEFAULT current_date,
    data_competencia        date NOT NULL DEFAULT current_date,
    valor_bruto             dom_valor NOT NULL,
    valor_desconto          dom_valor NOT NULL DEFAULT 0,
    valor_liquido           dom_valor NOT NULL,
    valor_liquidado         dom_valor NOT NULL DEFAULT 0,
    saldo                   dom_valor NOT NULL DEFAULT 0,
    -- Classificacao (RF-054)
    categoria_financeira_id uuid REFERENCES categoria_financeira(id) ON DELETE SET NULL,
    centro_custo_id         uuid REFERENCES centro_custo(id) ON DELETE SET NULL,
    conta_contabil_id       uuid,                 -- FK em 03
    forma_pagamento_id      uuid REFERENCES forma_pagamento(id) ON DELETE SET NULL,
    condicao_pagamento_id   uuid REFERENCES condicao_pagamento(id) ON DELETE SET NULL,
    -- Origem (RF-051 / RF-052)
    origem_tipo             varchar(40),          -- MANUAL, DOCUMENTO_FISCAL, PEDIDO_COMPRA, REEMBOLSO, RECORRENCIA
    origem_id               uuid,
    documento_fiscal_id     uuid REFERENCES documento_fiscal(id) ON DELETE SET NULL,
    pedido_compra_id        uuid REFERENCES pedido_compra(id)    ON DELETE SET NULL,
    recorrencia_id          uuid REFERENCES recorrencia(id)      ON DELETE SET NULL,
    -- Situacao
    status                  enum_status_titulo NOT NULL DEFAULT 'ABERTO',
    status_aprovacao        enum_status_aprovacao NOT NULL DEFAULT 'NAO_REQUERIDA',
    cancelado_em            timestamptz,
    motivo_cancelamento     text,
    observacao              text,
    criado_por              uuid REFERENCES usuario(id) ON DELETE SET NULL,
    criado_em               timestamptz NOT NULL DEFAULT now(),
    atualizado_em           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_titulo_numero UNIQUE (empresa_id, tipo, numero),
    CONSTRAINT ck_titulo_valores CHECK (valor_bruto >= 0 AND valor_liquido >= 0 AND valor_liquidado >= 0),
    CONSTRAINT ck_titulo_credor CHECK (parceiro_id IS NOT NULL OR funcionario_id IS NOT NULL)
);
CREATE INDEX ix_titulo_empresa_tipo ON titulo (empresa_id, tipo, status);
CREATE INDEX ix_titulo_parceiro ON titulo (parceiro_id, data_emissao DESC);
CREATE INDEX ix_titulo_competencia ON titulo (empresa_id, data_competencia);

ALTER TABLE reembolso
    ADD CONSTRAINT fk_reembolso_titulo
    FOREIGN KEY (titulo_id) REFERENCES titulo(id) ON DELETE SET NULL;

-- Parcelas (RF-053 / RF-055)
CREATE TABLE titulo_parcela (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id          uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    titulo_id           uuid NOT NULL REFERENCES titulo(id) ON DELETE CASCADE,
    numero_parcela      smallint NOT NULL,
    total_parcelas      smallint NOT NULL DEFAULT 1,
    data_vencimento     date NOT NULL,
    data_vencimento_original date,
    valor               dom_valor NOT NULL,
    valor_juros         dom_valor NOT NULL DEFAULT 0,
    valor_multa         dom_valor NOT NULL DEFAULT 0,
    valor_desconto      dom_valor NOT NULL DEFAULT 0,
    valor_liquidado     dom_valor NOT NULL DEFAULT 0,
    saldo               dom_valor NOT NULL DEFAULT 0,
    percentual_juros_dia dom_percentual NOT NULL DEFAULT 0,
    percentual_multa    dom_percentual NOT NULL DEFAULT 0,
    data_liquidacao     date,
    status              enum_status_parcela NOT NULL DEFAULT 'ABERTA',
    codigo_barras       varchar(60),
    linha_digitavel     varchar(60),
    nosso_numero        varchar(30),
    observacao          text,
    criado_em           timestamptz NOT NULL DEFAULT now(),
    atualizado_em       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_titulo_parcela UNIQUE (titulo_id, numero_parcela),
    CONSTRAINT ck_parcela_valor CHECK (valor > 0),
    CONSTRAINT ck_parcela_liquidado CHECK (valor_liquidado >= 0)
);
CREATE INDEX ix_parcela_vencimento ON titulo_parcela (empresa_id, data_vencimento) WHERE status IN ('ABERTA','PARCIALMENTE_LIQUIDADA');
CREATE INDEX ix_parcela_titulo ON titulo_parcela (titulo_id);

-- Baixas: pagamento ou recebimento total/parcial (RF-057)
CREATE TABLE titulo_baixa (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id              uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    titulo_parcela_id       uuid NOT NULL REFERENCES titulo_parcela(id) ON DELETE RESTRICT,
    data_baixa              date NOT NULL DEFAULT current_date,
    valor_principal         dom_valor NOT NULL,
    valor_juros             dom_valor NOT NULL DEFAULT 0,
    valor_multa             dom_valor NOT NULL DEFAULT 0,
    valor_desconto          dom_valor NOT NULL DEFAULT 0,
    valor_total             dom_valor NOT NULL,
    conta_bancaria_id       uuid,       -- FK adicionada adiante
    forma_pagamento_id      uuid REFERENCES forma_pagamento(id) ON DELETE SET NULL,
    metodo                  enum_metodo_pagamento,
    transacao_pagamento_id  uuid,       -- FK adicionada adiante
    estornada               boolean NOT NULL DEFAULT false,
    estorno_de_id           uuid REFERENCES titulo_baixa(id) ON DELETE SET NULL,
    estornada_em            timestamptz,
    motivo_estorno          text,
    documento_id            uuid REFERENCES documento(id) ON DELETE SET NULL,
    observacao              text,
    criado_por              uuid REFERENCES usuario(id) ON DELETE SET NULL,
    criado_em               timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_baixa_valores CHECK (valor_principal >= 0 AND valor_total >= 0)
);
CREATE INDEX ix_baixa_parcela ON titulo_baixa (titulo_parcela_id);
CREATE INDEX ix_baixa_data ON titulo_baixa (empresa_id, data_baixa);
COMMENT ON TABLE titulo_baixa IS 'RN-006/RN-009 - baixas e estornos preservam historico (append-only).';

-- =============================================================================
-- M09 - BANCOS, PAGAMENTOS E RECEBIMENTOS             (RF-059 a RF-070)
-- =============================================================================

CREATE TABLE provider (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo              varchar(40) NOT NULL,       -- ITAU, BB, ASAAS, SICOOB, GOOGLE_VISION
    nome                varchar(120) NOT NULL,
    categoria           enum_categoria_provider NOT NULL,
    descricao           text,
    capacidades         jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {"pix":true,"boleto":true,"cancelamento":false}
    ativo               boolean NOT NULL DEFAULT true,
    criado_em           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_provider_codigo UNIQUE (codigo)
);
COMMENT ON TABLE provider IS 'RF-061 / RNF-011 - abstracao de integracoes externas.';

CREATE TABLE credencial_integracao (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id          uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    provider_id         uuid NOT NULL REFERENCES provider(id) ON DELETE RESTRICT,
    nome                varchar(120) NOT NULL,
    ambiente            varchar(20) NOT NULL DEFAULT 'PRODUCAO',   -- SANDBOX / PRODUCAO
    credenciais_cifradas bytea NOT NULL,           -- RNF-003 / RNF-005
    chave_kms           varchar(255),
    certificado_ref     varchar(255),
    expira_em           timestamptz,
    ativo               boolean NOT NULL DEFAULT true,
    criado_em           timestamptz NOT NULL DEFAULT now(),
    atualizado_em       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_credencial UNIQUE (empresa_id, provider_id, ambiente, nome)
);
COMMENT ON COLUMN credencial_integracao.credenciais_cifradas IS 'Payload cifrado pela aplicacao; nunca em texto claro.';

CREATE TABLE conta_bancaria (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id          uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    filial_id           uuid REFERENCES filial(id) ON DELETE SET NULL,
    provider_id         uuid REFERENCES provider(id) ON DELETE SET NULL,
    credencial_id       uuid REFERENCES credencial_integracao(id) ON DELETE SET NULL,
    descricao           varchar(120) NOT NULL,
    banco_codigo        varchar(5) NOT NULL,
    banco_nome          varchar(120),
    agencia             varchar(10) NOT NULL,
    agencia_digito      varchar(2),
    conta               varchar(20) NOT NULL,
    conta_digito        varchar(2),
    tipo_conta          varchar(20) NOT NULL DEFAULT 'CORRENTE',
    chave_pix           varchar(140),
    conta_contabil_id   uuid,                       -- FK em 03
    saldo_inicial       dom_valor NOT NULL DEFAULT 0,
    saldo_atual         dom_valor NOT NULL DEFAULT 0,
    data_saldo          date,
    permite_pagamento   boolean NOT NULL DEFAULT true,
    permite_recebimento boolean NOT NULL DEFAULT true,
    padrao              boolean NOT NULL DEFAULT false,
    ativo               boolean NOT NULL DEFAULT true,
    criado_em           timestamptz NOT NULL DEFAULT now(),
    atualizado_em       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_conta_bancaria UNIQUE (empresa_id, banco_codigo, agencia, conta)
);
CREATE INDEX ix_conta_bancaria_empresa ON conta_bancaria (empresa_id) WHERE ativo;

ALTER TABLE forma_pagamento
    ADD CONSTRAINT fk_forma_pagamento_conta
    FOREIGN KEY (conta_bancaria_padrao_id) REFERENCES conta_bancaria(id) ON DELETE SET NULL;
ALTER TABLE titulo_baixa
    ADD CONSTRAINT fk_baixa_conta_bancaria
    FOREIGN KEY (conta_bancaria_id) REFERENCES conta_bancaria(id) ON DELETE SET NULL;

-- Controle de idempotencia (RF-067 / RN-004 / RN-005)
CREATE TABLE idempotencia (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id          uuid REFERENCES empresa(id) ON DELETE CASCADE,
    escopo              varchar(60) NOT NULL,     -- PAGAMENTO, WEBHOOK, IMPORTACAO
    chave               varchar(255) NOT NULL,
    request_hash        varchar(64),
    recurso_tipo        varchar(60),
    recurso_id          uuid,
    resposta            jsonb,
    status_http         smallint,
    expira_em           timestamptz,
    criado_em           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_idempotencia UNIQUE (escopo, chave)
);
CREATE INDEX ix_idempotencia_expira ON idempotencia (expira_em);

-- Transacoes de pagamento/recebimento (RF-062 a RF-070)
CREATE TABLE transacao_pagamento (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id              uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    conta_bancaria_id       uuid NOT NULL REFERENCES conta_bancaria(id) ON DELETE RESTRICT,
    provider_id             uuid REFERENCES provider(id) ON DELETE SET NULL,
    titulo_parcela_id       uuid REFERENCES titulo_parcela(id) ON DELETE SET NULL,
    sentido                 enum_sentido_transacao NOT NULL,
    metodo                  enum_metodo_pagamento NOT NULL,
    status                  enum_status_transacao NOT NULL DEFAULT 'CRIADA',
    valor                   dom_valor NOT NULL,
    data_agendamento        date,                   -- RF-063
    data_execucao           timestamptz,
    data_confirmacao        timestamptz,
    -- Dados do favorecido
    favorecido_nome         varchar(255),
    favorecido_documento    varchar(14),
    favorecido_banco        varchar(5),
    favorecido_agencia      varchar(10),
    favorecido_conta        varchar(20),
    chave_pix               varchar(140),
    codigo_barras           varchar(60),
    -- Rastreabilidade externa (RF-067 / RF-068)
    idempotency_key         varchar(255) NOT NULL,
    identificador_externo   varchar(140),           -- endToEndId, txid, id do provider
    end_to_end_id           varchar(60),
    payload_envio           jsonb,
    payload_retorno         jsonb,
    codigo_erro             varchar(60),
    mensagem_erro           text,
    tentativas              smallint NOT NULL DEFAULT 0,        -- RF-070
    max_tentativas          smallint NOT NULL DEFAULT 5,
    proxima_tentativa_em    timestamptz,
    cancelavel              boolean NOT NULL DEFAULT false,     -- RF-065
    cancelada_em            timestamptz,
    estorno_de_id           uuid REFERENCES transacao_pagamento(id) ON DELETE SET NULL,
    solicitado_por          uuid REFERENCES usuario(id) ON DELETE SET NULL,
    criado_em               timestamptz NOT NULL DEFAULT now(),
    atualizado_em           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_transacao_idempotency UNIQUE (empresa_id, idempotency_key),
    CONSTRAINT ck_transacao_valor CHECK (valor > 0)
);
CREATE UNIQUE INDEX ux_transacao_externa
    ON transacao_pagamento (provider_id, identificador_externo)
    WHERE identificador_externo IS NOT NULL;
CREATE INDEX ix_transacao_status ON transacao_pagamento (empresa_id, status);
CREATE INDEX ix_transacao_agendada ON transacao_pagamento (data_agendamento) WHERE status = 'AGENDADA';
COMMENT ON TABLE transacao_pagamento IS 'RN-004 - idempotency_key impede movimentacao duplicada.';

ALTER TABLE titulo_baixa
    ADD CONSTRAINT fk_baixa_transacao
    FOREIGN KEY (transacao_pagamento_id) REFERENCES transacao_pagamento(id) ON DELETE SET NULL;

-- Webhooks recebidos (RF-066 / RN-005)
CREATE TABLE webhook_evento (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id          uuid REFERENCES empresa(id) ON DELETE CASCADE,
    provider_id         uuid REFERENCES provider(id) ON DELETE SET NULL,
    evento_tipo         varchar(80) NOT NULL,
    evento_id_externo   varchar(160),
    assinatura          text,
    assinatura_valida   boolean,
    payload             jsonb NOT NULL,
    headers             jsonb,
    status              enum_status_job NOT NULL DEFAULT 'PENDENTE',
    tentativas          smallint NOT NULL DEFAULT 0,
    processado_em       timestamptz,
    erro                text,
    transacao_pagamento_id uuid REFERENCES transacao_pagamento(id) ON DELETE SET NULL,
    recebido_em         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_webhook_evento_externo
    ON webhook_evento (provider_id, evento_id_externo)
    WHERE evento_id_externo IS NOT NULL;
CREATE INDEX ix_webhook_pendente ON webhook_evento (status) WHERE status = 'PENDENTE';

-- Fila / jobs assincronos (RNF-009 / RNF-013 / RN-011)
CREATE TABLE job_execucao (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id          uuid REFERENCES empresa(id) ON DELETE CASCADE,
    fila                varchar(60) NOT NULL,
    nome                varchar(120) NOT NULL,
    payload             jsonb NOT NULL DEFAULT '{}'::jsonb,
    status              enum_status_job NOT NULL DEFAULT 'PENDENTE',
    tentativas          smallint NOT NULL DEFAULT 0,
    max_tentativas      smallint NOT NULL DEFAULT 5,
    agendado_para       timestamptz,
    iniciado_em         timestamptz,
    finalizado_em       timestamptz,
    duracao_ms          integer,
    erro                text,
    correlation_id      varchar(60),
    criado_em           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_job_status ON job_execucao (fila, status, agendado_para);

-- =============================================================================
-- M10 - CONCILIACAO BANCARIA                          (RF-071 a RF-077)
-- =============================================================================

CREATE TABLE extrato_importacao (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id          uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    conta_bancaria_id   uuid NOT NULL REFERENCES conta_bancaria(id) ON DELETE RESTRICT,
    formato             varchar(20) NOT NULL,     -- OFX, CSV, CNAB240, API
    nome_arquivo        varchar(255),
    hash_arquivo        varchar(64),
    periodo_inicio      date,
    periodo_fim         date,
    saldo_inicial       dom_valor,
    saldo_final         dom_valor,
    quantidade_registros integer NOT NULL DEFAULT 0,
    quantidade_importada integer NOT NULL DEFAULT 0,
    quantidade_duplicada integer NOT NULL DEFAULT 0,
    status              enum_status_job NOT NULL DEFAULT 'PENDENTE',
    erro                text,
    importado_por       uuid REFERENCES usuario(id) ON DELETE SET NULL,
    criado_em           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_extrato_hash UNIQUE (conta_bancaria_id, hash_arquivo)
);

CREATE TABLE transacao_bancaria (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id              uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    conta_bancaria_id       uuid NOT NULL REFERENCES conta_bancaria(id) ON DELETE RESTRICT,
    extrato_importacao_id   uuid REFERENCES extrato_importacao(id) ON DELETE SET NULL,
    data_movimento          date NOT NULL,
    data_lancamento         date,
    sentido                 enum_sentido_transacao NOT NULL,
    valor                   dom_valor NOT NULL,
    saldo_apos              dom_valor,
    descricao               varchar(255),
    documento               varchar(60),
    identificador_externo   varchar(140),     -- FITID (OFX) / id da API
    contraparte_nome        varchar(255),
    contraparte_documento   varchar(14),
    status_conciliacao      enum_status_conciliacao NOT NULL DEFAULT 'NAO_CONCILIADO',
    metadados               jsonb NOT NULL DEFAULT '{}'::jsonb,
    criado_em               timestamptz NOT NULL DEFAULT now(),
    atualizado_em           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_transacao_bancaria_valor CHECK (valor > 0)
);
CREATE UNIQUE INDEX ux_transacao_bancaria_fitid
    ON transacao_bancaria (conta_bancaria_id, identificador_externo)
    WHERE identificador_externo IS NOT NULL;
CREATE INDEX ix_transacao_bancaria_pendente
    ON transacao_bancaria (empresa_id, conta_bancaria_id, data_movimento)
    WHERE status_conciliacao IN ('NAO_CONCILIADO','SUGERIDO','DIVERGENTE');

CREATE TABLE regra_conciliacao (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id          uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    nome                varchar(120) NOT NULL,
    prioridade          smallint NOT NULL DEFAULT 100,
    condicoes           jsonb NOT NULL,   -- {"descricao_contem":"TARIFA","valor_max":50}
    acoes               jsonb NOT NULL,   -- {"categoria_id":"...","conciliar_automatico":true}
    tolerancia_valor    dom_valor NOT NULL DEFAULT 0,
    tolerancia_dias     smallint NOT NULL DEFAULT 3,
    ativo               boolean NOT NULL DEFAULT true,
    criado_em           timestamptz NOT NULL DEFAULT now(),
    atualizado_em       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE conciliacao (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id              uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    transacao_bancaria_id   uuid NOT NULL REFERENCES transacao_bancaria(id) ON DELETE CASCADE,
    titulo_parcela_id       uuid REFERENCES titulo_parcela(id) ON DELETE SET NULL,
    titulo_baixa_id         uuid REFERENCES titulo_baixa(id)   ON DELETE SET NULL,
    transacao_pagamento_id  uuid REFERENCES transacao_pagamento(id) ON DELETE SET NULL,
    regra_conciliacao_id    uuid REFERENCES regra_conciliacao(id)   ON DELETE SET NULL,
    origem                  enum_origem_conciliacao NOT NULL DEFAULT 'MANUAL',
    score                   numeric(5,2),        -- confianca da sugestao (RF-073)
    valor_conciliado        dom_valor NOT NULL,
    diferenca               dom_valor NOT NULL DEFAULT 0,
    possui_divergencia      boolean NOT NULL DEFAULT false,
    justificativa           text,
    confirmada              boolean NOT NULL DEFAULT false,
    confirmada_por          uuid REFERENCES usuario(id) ON DELETE SET NULL,
    confirmada_em           timestamptz,
    desfeita_em             timestamptz,
    criado_em               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_conciliacao_transacao ON conciliacao (transacao_bancaria_id);
CREATE INDEX ix_conciliacao_parcela ON conciliacao (titulo_parcela_id);

-- Views de compatibilidade com a nomenclatura da ERS
CREATE OR REPLACE VIEW vw_conta_pagar AS
    SELECT * FROM titulo WHERE tipo = 'PAGAR';
CREATE OR REPLACE VIEW vw_conta_receber AS
    SELECT * FROM titulo WHERE tipo = 'RECEBER';

-- Inadimplencia (RF-058)
CREATE OR REPLACE VIEW vw_titulos_vencidos AS
SELECT t.empresa_id,
       t.tipo,
       t.id AS titulo_id,
       p.id AS parcela_id,
       t.parceiro_id,
       t.descricao,
       p.numero_parcela,
       p.data_vencimento,
       (current_date - p.data_vencimento) AS dias_atraso,
       p.saldo
FROM titulo_parcela p
JOIN titulo t ON t.id = p.titulo_id
WHERE p.status IN ('ABERTA','PARCIALMENTE_LIQUIDADA')
  AND p.data_vencimento < current_date
  AND t.status <> 'CANCELADO';
