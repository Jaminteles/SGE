-- =============================================================================
-- SISTEMA INTEGRADO DE GESTAO EMPRESARIAL E FINANCEIRA
-- Modelo Fisico - PostgreSQL 14+
-- Parte 1/3: Extensoes, dominios, tipos, nucleo, RH, parceiros, produtos/estoque
-- Referencia: ERS v1.0 (05/08/2026)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. EXTENSOES E CONFIGURACOES GLOBAIS
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;      -- gen_random_uuid(), crypt()
CREATE EXTENSION IF NOT EXISTS pg_trgm;       -- busca textual em cadastros
CREATE EXTENSION IF NOT EXISTS btree_gist;    -- constraints de exclusao por periodo
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Schema unico da aplicacao (multiempresa logico via coluna empresa_id)
CREATE SCHEMA IF NOT EXISTS gestao;
SET search_path = gestao, public;

-- -----------------------------------------------------------------------------
-- 0.1 DOMINIOS (RN-012: precisao decimal adequada)
-- -----------------------------------------------------------------------------
CREATE DOMAIN dom_valor        AS numeric(18,2);   -- valores monetarios
CREATE DOMAIN dom_valor_unit   AS numeric(18,6);   -- precos unitarios / custos
CREATE DOMAIN dom_quantidade   AS numeric(18,6);   -- quantidades de estoque
CREATE DOMAIN dom_percentual   AS numeric(9,6);    -- aliquotas, juros, descontos
CREATE DOMAIN dom_email        AS varchar(255) CHECK (VALUE ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');
CREATE DOMAIN dom_cnpj         AS varchar(14)  CHECK (VALUE ~ '^[0-9]{14}$');
CREATE DOMAIN dom_cpf          AS varchar(11)  CHECK (VALUE ~ '^[0-9]{11}$');
CREATE DOMAIN dom_uf           AS char(2)      CHECK (VALUE ~ '^[A-Z]{2}$');

-- -----------------------------------------------------------------------------
-- 0.2 TIPOS ENUMERADOS
-- -----------------------------------------------------------------------------
CREATE TYPE enum_tipo_pessoa            AS ENUM ('PF','PJ','ESTRANGEIRO');
CREATE TYPE enum_regime_tributario      AS ENUM ('SIMPLES_NACIONAL','LUCRO_PRESUMIDO','LUCRO_REAL','MEI','IMUNE_ISENTO');
CREATE TYPE enum_status_aprovacao       AS ENUM ('NAO_REQUERIDA','PENDENTE','APROVADO','REPROVADO','CANCELADO');
CREATE TYPE enum_status_funcionario     AS ENUM ('ATIVO','AFASTADO','FERIAS','DESLIGADO');
CREATE TYPE enum_tipo_evento_rh         AS ENUM ('ADMISSAO','PROMOCAO','TRANSFERENCIA','AFASTAMENTO','FERIAS','RETORNO','DESLIGAMENTO','ALTERACAO_SALARIAL');
CREATE TYPE enum_tipo_verba             AS ENUM ('SALARIO','BENEFICIO','DESCONTO','ADICIONAL','ENCARGO');
CREATE TYPE enum_status_reembolso       AS ENUM ('RASCUNHO','SOLICITADO','EM_ANALISE','APROVADO','REPROVADO','PAGO','CANCELADO');
CREATE TYPE enum_tipo_item              AS ENUM ('PRODUTO','SERVICO','MATERIA_PRIMA','ATIVO_IMOBILIZADO');
CREATE TYPE enum_tipo_mov_estoque       AS ENUM ('ENTRADA','SAIDA','TRANSFERENCIA_ENTRADA','TRANSFERENCIA_SAIDA','AJUSTE_POSITIVO','AJUSTE_NEGATIVO','INVENTARIO');
CREATE TYPE enum_status_pedido_compra   AS ENUM ('RASCUNHO','AGUARDANDO_APROVACAO','APROVADO','REPROVADO','PARCIALMENTE_RECEBIDO','RECEBIDO','CANCELADO');
CREATE TYPE enum_status_doc_fiscal      AS ENUM ('RECEBIDO','PROCESSANDO','PROCESSADO','ERRO','DUPLICADO','CANCELADO','DENEGADO');
CREATE TYPE enum_modelo_doc_fiscal      AS ENUM ('NFE','NFCE','NFSE','CTE','CTE_OS','MDFE','NFAVULSA','RECIBO','OUTRO');
CREATE TYPE enum_origem_doc_fiscal      AS ENUM ('UPLOAD_MANUAL','COLETA_AUTOMATICA','API','EMAIL','WEBHOOK');
CREATE TYPE enum_tipo_titulo            AS ENUM ('PAGAR','RECEBER');
CREATE TYPE enum_status_titulo          AS ENUM ('ABERTO','PARCIALMENTE_LIQUIDADO','LIQUIDADO','CANCELADO','RENEGOCIADO');
CREATE TYPE enum_status_parcela         AS ENUM ('ABERTA','PARCIALMENTE_LIQUIDADA','LIQUIDADA','CANCELADA','RENEGOCIADA');
CREATE TYPE enum_periodicidade          AS ENUM ('UNICA','DIARIA','SEMANAL','QUINZENAL','MENSAL','BIMESTRAL','TRIMESTRAL','SEMESTRAL','ANUAL');
CREATE TYPE enum_metodo_pagamento       AS ENUM ('PIX','BOLETO','TED','DOC','TRANSFERENCIA_INTERNA','DEBITO_AUTOMATICO','CARTAO_CREDITO','CARTAO_DEBITO','DINHEIRO','CHEQUE','COMPENSACAO','OUTRO');
CREATE TYPE enum_status_transacao       AS ENUM ('CRIADA','AGENDADA','ENFILEIRADA','ENVIADA','PROCESSANDO','CONFIRMADA','FALHA','CANCELADA','ESTORNADA','EXPIRADA');
CREATE TYPE enum_sentido_transacao      AS ENUM ('DEBITO','CREDITO');
CREATE TYPE enum_status_conciliacao     AS ENUM ('NAO_CONCILIADO','SUGERIDO','CONCILIADO','DIVERGENTE','IGNORADO');
CREATE TYPE enum_origem_conciliacao     AS ENUM ('MANUAL','AUTOMATICA_REGRA','AUTOMATICA_EXATA','IMPORTACAO');
CREATE TYPE enum_tipo_conta_contabil    AS ENUM ('ATIVO','PASSIVO','PATRIMONIO_LIQUIDO','RECEITA','DESPESA','CUSTO','COMPENSACAO');
CREATE TYPE enum_natureza_conta         AS ENUM ('DEVEDORA','CREDORA');
CREATE TYPE enum_tipo_partida           AS ENUM ('DEBITO','CREDITO');
CREATE TYPE enum_status_periodo         AS ENUM ('ABERTO','EM_FECHAMENTO','FECHADO','REABERTO');
CREATE TYPE enum_status_ocr             AS ENUM ('PENDENTE','PROCESSANDO','PROCESSADO','ERRO','VALIDADO','REJEITADO');
CREATE TYPE enum_status_job             AS ENUM ('PENDENTE','PROCESSANDO','CONCLUIDO','FALHA','CANCELADO','AGENDADO');
CREATE TYPE enum_canal_notificacao      AS ENUM ('INTERNO','EMAIL','SMS','PUSH','WEBHOOK');
CREATE TYPE enum_status_notificacao     AS ENUM ('PENDENTE','ENVIADA','LIDA','FALHA','CANCELADA');
CREATE TYPE enum_tipo_evento_auditoria  AS ENUM ('CRIACAO','ALTERACAO','EXCLUSAO','APROVACAO','REPROVACAO','PAGAMENTO','RECEBIMENTO','CANCELAMENTO','ESTORNO','LOGIN','LOGOUT','ACESSO_NEGADO','EXPORTACAO','IMPORTACAO','FECHAMENTO','REABERTURA');
CREATE TYPE enum_status_integracao      AS ENUM ('ATIVA','INATIVA','ERRO','SUSPENSA');
CREATE TYPE enum_categoria_provider     AS ENUM ('BANCARIO','PIX','BOLETO','FISCAL','OCR','EMAIL','CONTABIL','ARMAZENAMENTO','OUTRO');
CREATE TYPE enum_realizacao             AS ENUM ('PREVISTO','REALIZADO','VENCIDO');

-- -----------------------------------------------------------------------------
-- 0.3 FUNCOES UTILITARIAS
-- -----------------------------------------------------------------------------

-- Atualiza automaticamente a coluna atualizado_em
CREATE OR REPLACE FUNCTION fn_set_atualizado_em() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.atualizado_em := now();
    RETURN NEW;
END;
$$;

-- Usuario corrente da sessao da aplicacao (SET LOCAL app.usuario_id = '...')
CREATE OR REPLACE FUNCTION fn_usuario_corrente() RETURNS uuid
LANGUAGE plpgsql STABLE AS $$
DECLARE v text;
BEGIN
    v := current_setting('app.usuario_id', true);
    IF v IS NULL OR v = '' THEN RETURN NULL; END IF;
    RETURN v::uuid;
EXCEPTION WHEN others THEN RETURN NULL;
END;
$$;

-- Empresa corrente da sessao (base para RLS - RN-001 / RN-002)
CREATE OR REPLACE FUNCTION fn_empresa_corrente() RETURNS uuid
LANGUAGE plpgsql STABLE AS $$
DECLARE v text;
BEGIN
    v := current_setting('app.empresa_id', true);
    IF v IS NULL OR v = '' THEN RETURN NULL; END IF;
    RETURN v::uuid;
EXCEPTION WHEN others THEN RETURN NULL;
END;
$$;

-- =============================================================================
-- M01 - EMPRESAS, FILIAIS E CONFIGURACOES              (RF-001 a RF-006)
-- =============================================================================

CREATE TABLE empresa (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    razao_social        varchar(255) NOT NULL,
    nome_fantasia       varchar(255),
    tipo_pessoa         enum_tipo_pessoa NOT NULL DEFAULT 'PJ',
    cnpj                dom_cnpj,
    cpf                 dom_cpf,
    inscricao_estadual  varchar(20),
    inscricao_municipal varchar(20),
    regime_tributario   enum_regime_tributario,
    cnae_principal      varchar(10),
    email               dom_email,
    telefone            varchar(20),
    logo_url            text,
    timezone            varchar(50) NOT NULL DEFAULT 'America/Sao_Paulo',
    moeda               char(3) NOT NULL DEFAULT 'BRL',
    ativo               boolean NOT NULL DEFAULT true,
    criado_em           timestamptz NOT NULL DEFAULT now(),
    atualizado_em       timestamptz NOT NULL DEFAULT now(),
    criado_por          uuid,
    CONSTRAINT ck_empresa_documento CHECK (
        (tipo_pessoa = 'PJ' AND cnpj IS NOT NULL)
        OR (tipo_pessoa = 'PF' AND cpf IS NOT NULL)
        OR tipo_pessoa = 'ESTRANGEIRO'
    )
);
CREATE UNIQUE INDEX ux_empresa_cnpj ON empresa (cnpj) WHERE cnpj IS NOT NULL;
CREATE UNIQUE INDEX ux_empresa_cpf  ON empresa (cpf)  WHERE cpf  IS NOT NULL;
COMMENT ON TABLE empresa IS 'RF-001/RF-003 - Tenant logico da plataforma (RN-001).';

CREATE TABLE filial (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id          uuid NOT NULL REFERENCES empresa(id) ON DELETE RESTRICT,
    codigo              varchar(20) NOT NULL,
    nome                varchar(255) NOT NULL,
    cnpj                dom_cnpj,
    inscricao_estadual  varchar(20),
    inscricao_municipal varchar(20),
    matriz              boolean NOT NULL DEFAULT false,
    ativo               boolean NOT NULL DEFAULT true,
    criado_em           timestamptz NOT NULL DEFAULT now(),
    atualizado_em       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_filial_codigo UNIQUE (empresa_id, codigo)
);
CREATE INDEX ix_filial_empresa ON filial (empresa_id);
CREATE UNIQUE INDEX ux_filial_matriz ON filial (empresa_id) WHERE matriz;

-- Endereco polimorfico controlado: exatamente um proprietario (evita FK polimorfica solta)
CREATE TABLE endereco (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id      uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    tipo            varchar(30) NOT NULL DEFAULT 'PRINCIPAL',
    logradouro      varchar(255) NOT NULL,
    numero          varchar(20),
    complemento     varchar(100),
    bairro          varchar(120),
    cidade          varchar(120) NOT NULL,
    uf              dom_uf NOT NULL,
    cep             varchar(8),
    pais            varchar(60) NOT NULL DEFAULT 'Brasil',
    codigo_ibge     varchar(7),
    principal       boolean NOT NULL DEFAULT false,
    empresa_ref_id  uuid REFERENCES empresa(id)   ON DELETE CASCADE,
    filial_id       uuid REFERENCES filial(id)    ON DELETE CASCADE,
    parceiro_id     uuid,   -- FK adicionada apos criacao de parceiro
    funcionario_id  uuid,   -- FK adicionada apos criacao de funcionario
    criado_em       timestamptz NOT NULL DEFAULT now(),
    atualizado_em   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_endereco_proprietario CHECK (
        (empresa_ref_id IS NOT NULL)::int + (filial_id IS NOT NULL)::int
      + (parceiro_id   IS NOT NULL)::int + (funcionario_id IS NOT NULL)::int = 1
    )
);
CREATE INDEX ix_endereco_empresa ON endereco (empresa_id);

CREATE TABLE contato (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id      uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    nome            varchar(255) NOT NULL,
    cargo           varchar(120),
    email           dom_email,
    telefone        varchar(20),
    celular         varchar(20),
    observacao      text,
    principal       boolean NOT NULL DEFAULT false,
    parceiro_id     uuid,   -- FK adicionada adiante
    filial_id       uuid REFERENCES filial(id) ON DELETE CASCADE,
    criado_em       timestamptz NOT NULL DEFAULT now(),
    atualizado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_contato_empresa ON contato (empresa_id);

-- Centro de custo (hierarquico)
CREATE TABLE centro_custo (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id          uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    filial_id           uuid REFERENCES filial(id) ON DELETE SET NULL,
    centro_custo_pai_id uuid REFERENCES centro_custo(id) ON DELETE RESTRICT,
    codigo              varchar(30) NOT NULL,
    nome                varchar(255) NOT NULL,
    descricao           text,
    aceita_lancamento   boolean NOT NULL DEFAULT true,
    ativo               boolean NOT NULL DEFAULT true,
    criado_em           timestamptz NOT NULL DEFAULT now(),
    atualizado_em       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_centro_custo_codigo UNIQUE (empresa_id, codigo)
);
CREATE INDEX ix_centro_custo_empresa ON centro_custo (empresa_id);

-- Categoria financeira (plano gerencial, hierarquico)
CREATE TABLE categoria_financeira (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id      uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    categoria_pai_id uuid REFERENCES categoria_financeira(id) ON DELETE RESTRICT,
    codigo          varchar(30) NOT NULL,
    nome            varchar(255) NOT NULL,
    tipo            enum_tipo_titulo NOT NULL,
    conta_contabil_id uuid,     -- FK adicionada em 03 (contabilidade)
    aceita_lancamento boolean NOT NULL DEFAULT true,
    ativo           boolean NOT NULL DEFAULT true,
    criado_em       timestamptz NOT NULL DEFAULT now(),
    atualizado_em   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_categoria_financeira_codigo UNIQUE (empresa_id, codigo)
);
CREATE INDEX ix_categoria_financeira_empresa ON categoria_financeira (empresa_id);

-- Parametros gerais chave/valor por empresa (RF-006)
CREATE TABLE parametro_empresa (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id      uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    grupo           varchar(60) NOT NULL,     -- FINANCEIRO, FISCAL, COMPRAS, ...
    chave           varchar(120) NOT NULL,
    valor           jsonb NOT NULL,
    descricao       text,
    criado_em       timestamptz NOT NULL DEFAULT now(),
    atualizado_em   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_parametro_empresa UNIQUE (empresa_id, grupo, chave)
);

-- =============================================================================
-- M02 - USUARIOS, PERFIS E PERMISSOES                  (RF-007 a RF-012)
-- =============================================================================

CREATE TABLE usuario (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nome                    varchar(255) NOT NULL,
    email                   dom_email NOT NULL,
    senha_hash              text NOT NULL,                     -- RNF-001
    telefone                varchar(20),
    avatar_url              text,
    mfa_habilitado          boolean NOT NULL DEFAULT false,
    mfa_secret              text,
    email_verificado_em     timestamptz,
    ultimo_login_em         timestamptz,
    tentativas_login        smallint NOT NULL DEFAULT 0,
    bloqueado_ate           timestamptz,
    senha_alterada_em       timestamptz,
    ativo                   boolean NOT NULL DEFAULT true,
    criado_em               timestamptz NOT NULL DEFAULT now(),
    atualizado_em           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_usuario_email UNIQUE (email)
);
COMMENT ON COLUMN usuario.senha_hash IS 'RNF-001 - somente hash (argon2id/bcrypt).';

CREATE TABLE perfil (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id      uuid REFERENCES empresa(id) ON DELETE CASCADE, -- NULL = perfil global do sistema
    nome            varchar(120) NOT NULL,
    descricao       text,
    sistema         boolean NOT NULL DEFAULT false,  -- perfis nativos nao editaveis
    ativo           boolean NOT NULL DEFAULT true,
    criado_em       timestamptz NOT NULL DEFAULT now(),
    atualizado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_perfil_nome_empresa ON perfil (empresa_id, nome) WHERE empresa_id IS NOT NULL;
CREATE UNIQUE INDEX ux_perfil_nome_global  ON perfil (nome) WHERE empresa_id IS NULL;

CREATE TABLE permissao (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    modulo          varchar(60) NOT NULL,        -- ex.: CONTAS_PAGAR
    recurso         varchar(60) NOT NULL,        -- ex.: TITULO
    acao            varchar(40) NOT NULL,        -- ex.: CRIAR, APROVAR, EXPORTAR
    descricao       text,
    CONSTRAINT uq_permissao UNIQUE (modulo, recurso, acao)
);

CREATE TABLE perfil_permissao (
    perfil_id       uuid NOT NULL REFERENCES perfil(id)    ON DELETE CASCADE,
    permissao_id    uuid NOT NULL REFERENCES permissao(id) ON DELETE CASCADE,
    concedida_em    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (perfil_id, permissao_id)
);

-- Vinculo usuario x empresa x perfil (RF-004 / RF-005 / RN-002)
CREATE TABLE usuario_empresa (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id      uuid NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
    empresa_id      uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    perfil_id       uuid NOT NULL REFERENCES perfil(id)  ON DELETE RESTRICT,
    filial_id       uuid REFERENCES filial(id) ON DELETE SET NULL, -- NULL = todas as filiais
    padrao          boolean NOT NULL DEFAULT false,
    ativo           boolean NOT NULL DEFAULT true,
    criado_em       timestamptz NOT NULL DEFAULT now(),
    atualizado_em   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_usuario_empresa UNIQUE (usuario_id, empresa_id, filial_id, perfil_id)
);
CREATE INDEX ix_usuario_empresa_empresa ON usuario_empresa (empresa_id);

CREATE TABLE sessao (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id          uuid NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
    empresa_id          uuid REFERENCES empresa(id) ON DELETE CASCADE,
    refresh_token_hash  text NOT NULL,
    ip                  inet,
    user_agent          text,
    expira_em           timestamptz NOT NULL,
    revogada_em         timestamptz,
    criado_em           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_sessao_token UNIQUE (refresh_token_hash)
);
CREATE INDEX ix_sessao_usuario ON sessao (usuario_id) WHERE revogada_em IS NULL;

CREATE TABLE token_recuperacao (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id      uuid NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
    token_hash      text NOT NULL,
    finalidade      varchar(40) NOT NULL DEFAULT 'RESET_SENHA',
    expira_em       timestamptz NOT NULL,
    utilizado_em    timestamptz,
    criado_em       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_token_recuperacao UNIQUE (token_hash)
);

-- Alcadas de aprovacao (RF-012 / RN-003)
CREATE TABLE alcada (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id      uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    nome            varchar(120) NOT NULL,
    tipo_operacao   varchar(60) NOT NULL,   -- PEDIDO_COMPRA, TITULO_PAGAR, PAGAMENTO, REEMBOLSO
    valor_minimo    dom_valor NOT NULL DEFAULT 0,
    valor_maximo    dom_valor,
    nivel           smallint NOT NULL DEFAULT 1,
    aprovadores_min smallint NOT NULL DEFAULT 1,
    ativo           boolean NOT NULL DEFAULT true,
    criado_em       timestamptz NOT NULL DEFAULT now(),
    atualizado_em   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_alcada_faixa CHECK (valor_maximo IS NULL OR valor_maximo >= valor_minimo),
    CONSTRAINT uq_alcada UNIQUE (empresa_id, tipo_operacao, nivel)
);

CREATE TABLE alcada_aprovador (
    alcada_id       uuid NOT NULL REFERENCES alcada(id)  ON DELETE CASCADE,
    usuario_id      uuid REFERENCES usuario(id) ON DELETE CASCADE,
    perfil_id       uuid REFERENCES perfil(id)  ON DELETE CASCADE,
    PRIMARY KEY (alcada_id, usuario_id, perfil_id),
    CONSTRAINT ck_alcada_aprovador CHECK (
        (usuario_id IS NOT NULL)::int + (perfil_id IS NOT NULL)::int = 1
    )
);

-- Registro generico de aprovacoes (RN-003)
CREATE TABLE aprovacao (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id      uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    entidade        varchar(60) NOT NULL,       -- pedido_compra, titulo, reembolso, pagamento
    entidade_id     uuid NOT NULL,
    alcada_id       uuid REFERENCES alcada(id) ON DELETE SET NULL,
    nivel           smallint NOT NULL DEFAULT 1,
    status          enum_status_aprovacao NOT NULL DEFAULT 'PENDENTE',
    solicitante_id  uuid REFERENCES usuario(id) ON DELETE SET NULL,
    aprovador_id    uuid REFERENCES usuario(id) ON DELETE SET NULL,
    valor_referencia dom_valor,
    justificativa   text,
    decidido_em     timestamptz,
    criado_em       timestamptz NOT NULL DEFAULT now(),
    atualizado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_aprovacao_entidade ON aprovacao (empresa_id, entidade, entidade_id);
CREATE INDEX ix_aprovacao_pendente ON aprovacao (empresa_id, status) WHERE status = 'PENDENTE';

-- =============================================================================
-- M03 - FUNCIONARIOS E RECURSOS HUMANOS               (RF-013 a RF-021)
-- =============================================================================

CREATE TABLE departamento (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id          uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    departamento_pai_id uuid REFERENCES departamento(id) ON DELETE RESTRICT,
    centro_custo_id     uuid REFERENCES centro_custo(id) ON DELETE SET NULL,
    codigo              varchar(30) NOT NULL,
    nome                varchar(255) NOT NULL,
    ativo               boolean NOT NULL DEFAULT true,
    criado_em           timestamptz NOT NULL DEFAULT now(),
    atualizado_em       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_departamento_codigo UNIQUE (empresa_id, codigo)
);

CREATE TABLE cargo (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id      uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    codigo          varchar(30) NOT NULL,
    nome            varchar(255) NOT NULL,
    cbo             varchar(10),
    descricao       text,
    faixa_salarial_min dom_valor,
    faixa_salarial_max dom_valor,
    ativo           boolean NOT NULL DEFAULT true,
    criado_em       timestamptz NOT NULL DEFAULT now(),
    atualizado_em   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_cargo_codigo UNIQUE (empresa_id, codigo)
);

CREATE TABLE funcionario (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id          uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    filial_id           uuid REFERENCES filial(id) ON DELETE SET NULL,
    usuario_id          uuid REFERENCES usuario(id) ON DELETE SET NULL,
    matricula           varchar(30) NOT NULL,
    nome                varchar(255) NOT NULL,
    cpf                 dom_cpf NOT NULL,
    rg                  varchar(20),
    pis                 varchar(15),
    data_nascimento     date,
    email_corporativo   dom_email,
    telefone            varchar(20),
    cargo_id            uuid REFERENCES cargo(id)         ON DELETE SET NULL,
    departamento_id     uuid REFERENCES departamento(id)  ON DELETE SET NULL,
    centro_custo_id     uuid REFERENCES centro_custo(id)  ON DELETE SET NULL,  -- RF-016
    gestor_id           uuid REFERENCES funcionario(id)   ON DELETE SET NULL,
    data_admissao       date NOT NULL,
    data_desligamento   date,
    motivo_desligamento text,
    tipo_contrato       varchar(40),           -- CLT, PJ, ESTAGIO, TEMPORARIO
    status              enum_status_funcionario NOT NULL DEFAULT 'ATIVO',
    salario_base        dom_valor,
    criado_em           timestamptz NOT NULL DEFAULT now(),
    atualizado_em       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_funcionario_matricula UNIQUE (empresa_id, matricula),
    CONSTRAINT uq_funcionario_cpf UNIQUE (empresa_id, cpf),
    CONSTRAINT ck_funcionario_datas CHECK (data_desligamento IS NULL OR data_desligamento >= data_admissao)
);
CREATE INDEX ix_funcionario_empresa ON funcionario (empresa_id);
CREATE INDEX ix_funcionario_nome_trgm ON funcionario USING gin (nome gin_trgm_ops);

ALTER TABLE endereco
    ADD CONSTRAINT fk_endereco_funcionario
    FOREIGN KEY (funcionario_id) REFERENCES funcionario(id) ON DELETE CASCADE;

-- Dados bancarios (funcionario ou parceiro) - RF-013 / RF-024
CREATE TABLE dado_bancario (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id      uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    funcionario_id  uuid REFERENCES funcionario(id) ON DELETE CASCADE,
    parceiro_id     uuid,   -- FK adicionada adiante
    banco_codigo    varchar(5),
    banco_nome      varchar(120),
    agencia         varchar(10),
    agencia_digito  varchar(2),
    conta           varchar(20),
    conta_digito    varchar(2),
    tipo_conta      varchar(20),          -- CORRENTE, POUPANCA, PAGAMENTO
    titular_nome    varchar(255),
    titular_documento varchar(14),
    chave_pix       varchar(140),
    tipo_chave_pix  varchar(20),          -- CPF, CNPJ, EMAIL, TELEFONE, ALEATORIA
    principal       boolean NOT NULL DEFAULT false,
    ativo           boolean NOT NULL DEFAULT true,
    criado_em       timestamptz NOT NULL DEFAULT now(),
    atualizado_em   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_dado_bancario_proprietario CHECK (
        (funcionario_id IS NOT NULL)::int + (parceiro_id IS NOT NULL)::int = 1
    )
);
CREATE INDEX ix_dado_bancario_empresa ON dado_bancario (empresa_id);

-- Historico funcional (RF-015 / RF-020)
CREATE TABLE funcionario_evento (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id      uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    funcionario_id  uuid NOT NULL REFERENCES funcionario(id) ON DELETE CASCADE,
    tipo            enum_tipo_evento_rh NOT NULL,
    data_inicio     date NOT NULL,
    data_fim        date,
    cargo_id        uuid REFERENCES cargo(id)        ON DELETE SET NULL,
    departamento_id uuid REFERENCES departamento(id) ON DELETE SET NULL,
    centro_custo_id uuid REFERENCES centro_custo(id) ON DELETE SET NULL,
    salario         dom_valor,
    observacao      text,
    registrado_por  uuid REFERENCES usuario(id) ON DELETE SET NULL,
    criado_em       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_funcionario_evento_periodo CHECK (data_fim IS NULL OR data_fim >= data_inicio)
);
CREATE INDEX ix_funcionario_evento_func ON funcionario_evento (funcionario_id, data_inicio DESC);

-- Verbas: salarios, beneficios e descontos (RF-017 / RF-021)
CREATE TABLE verba (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id      uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    codigo          varchar(30) NOT NULL,
    nome            varchar(255) NOT NULL,
    tipo            enum_tipo_verba NOT NULL,
    conta_contabil_id uuid,
    categoria_financeira_id uuid REFERENCES categoria_financeira(id) ON DELETE SET NULL,
    incide_inss     boolean NOT NULL DEFAULT false,
    incide_irrf     boolean NOT NULL DEFAULT false,
    incide_fgts     boolean NOT NULL DEFAULT false,
    ativo           boolean NOT NULL DEFAULT true,
    criado_em       timestamptz NOT NULL DEFAULT now(),
    atualizado_em   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_verba_codigo UNIQUE (empresa_id, codigo)
);

CREATE TABLE funcionario_verba (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id      uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    funcionario_id  uuid NOT NULL REFERENCES funcionario(id) ON DELETE CASCADE,
    verba_id        uuid NOT NULL REFERENCES verba(id) ON DELETE RESTRICT,
    valor           dom_valor,
    percentual      dom_percentual,
    vigencia_inicio date NOT NULL,
    vigencia_fim    date,
    observacao      text,
    criado_em       timestamptz NOT NULL DEFAULT now(),
    atualizado_em   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_funcionario_verba_valor CHECK (valor IS NOT NULL OR percentual IS NOT NULL),
    CONSTRAINT ck_funcionario_verba_vigencia CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio)
);
CREATE INDEX ix_funcionario_verba_func ON funcionario_verba (funcionario_id);

-- Despesas e reembolsos (RF-018 / RF-019)
CREATE TABLE reembolso (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id          uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    filial_id           uuid REFERENCES filial(id) ON DELETE SET NULL,
    funcionario_id      uuid NOT NULL REFERENCES funcionario(id) ON DELETE RESTRICT,
    numero              varchar(30) NOT NULL,
    descricao           varchar(255) NOT NULL,
    data_solicitacao    date NOT NULL DEFAULT current_date,
    valor_total         dom_valor NOT NULL DEFAULT 0,
    valor_aprovado      dom_valor,
    status              enum_status_reembolso NOT NULL DEFAULT 'RASCUNHO',
    centro_custo_id     uuid REFERENCES centro_custo(id) ON DELETE SET NULL,
    titulo_id           uuid,   -- gera conta a pagar (FK em 02)
    aprovado_por        uuid REFERENCES usuario(id) ON DELETE SET NULL,
    aprovado_em         timestamptz,
    observacao          text,
    criado_em           timestamptz NOT NULL DEFAULT now(),
    atualizado_em       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_reembolso_numero UNIQUE (empresa_id, numero),
    CONSTRAINT ck_reembolso_valor CHECK (valor_total >= 0)
);
CREATE INDEX ix_reembolso_funcionario ON reembolso (funcionario_id, status);

CREATE TABLE reembolso_item (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id          uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    reembolso_id        uuid NOT NULL REFERENCES reembolso(id) ON DELETE CASCADE,
    descricao           varchar(255) NOT NULL,
    data_despesa        date NOT NULL,
    valor               dom_valor NOT NULL,
    categoria_financeira_id uuid REFERENCES categoria_financeira(id) ON DELETE SET NULL,
    centro_custo_id     uuid REFERENCES centro_custo(id) ON DELETE SET NULL,
    documento_id        uuid,   -- comprovante / OCR (FK em 03)
    aprovado            boolean,
    observacao          text,
    criado_em           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_reembolso_item_valor CHECK (valor > 0)
);
CREATE INDEX ix_reembolso_item_reembolso ON reembolso_item (reembolso_id);

-- =============================================================================
-- M04 - CLIENTES E FORNECEDORES                        (RF-022 a RF-027)
-- =============================================================================
-- Decisao de modelagem: entidade unica "parceiro" com papeis (eh_cliente /
-- eh_fornecedor), pois na pratica a mesma pessoa juridica pode exercer os dois
-- papeis. Dados especificos ficam em cliente / fornecedor (1:1).

CREATE TABLE parceiro (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id          uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    tipo_pessoa         enum_tipo_pessoa NOT NULL,
    codigo              varchar(30),
    razao_social        varchar(255) NOT NULL,
    nome_fantasia       varchar(255),
    cnpj                dom_cnpj,
    cpf                 dom_cpf,
    documento_estrangeiro varchar(30),
    inscricao_estadual  varchar(20),
    inscricao_municipal varchar(20),
    contribuinte_icms   boolean NOT NULL DEFAULT false,
    regime_tributario   enum_regime_tributario,
    email               dom_email,
    telefone            varchar(20),
    site                varchar(255),
    eh_cliente          boolean NOT NULL DEFAULT false,
    eh_fornecedor       boolean NOT NULL DEFAULT false,
    observacao          text,
    ativo               boolean NOT NULL DEFAULT true,
    criado_em           timestamptz NOT NULL DEFAULT now(),
    atualizado_em       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_parceiro_papel CHECK (eh_cliente OR eh_fornecedor),
    CONSTRAINT ck_parceiro_documento CHECK (
        (tipo_pessoa = 'PJ' AND cnpj IS NOT NULL)
        OR (tipo_pessoa = 'PF' AND cpf IS NOT NULL)
        OR (tipo_pessoa = 'ESTRANGEIRO' AND documento_estrangeiro IS NOT NULL)
    )
);
CREATE UNIQUE INDEX ux_parceiro_cnpj ON parceiro (empresa_id, cnpj) WHERE cnpj IS NOT NULL;
CREATE UNIQUE INDEX ux_parceiro_cpf  ON parceiro (empresa_id, cpf)  WHERE cpf  IS NOT NULL;
CREATE UNIQUE INDEX ux_parceiro_codigo ON parceiro (empresa_id, codigo) WHERE codigo IS NOT NULL;
CREATE INDEX ix_parceiro_razao_trgm ON parceiro USING gin (razao_social gin_trgm_ops);

ALTER TABLE endereco      ADD CONSTRAINT fk_endereco_parceiro      FOREIGN KEY (parceiro_id) REFERENCES parceiro(id) ON DELETE CASCADE;
ALTER TABLE contato       ADD CONSTRAINT fk_contato_parceiro       FOREIGN KEY (parceiro_id) REFERENCES parceiro(id) ON DELETE CASCADE;
ALTER TABLE dado_bancario ADD CONSTRAINT fk_dado_bancario_parceiro FOREIGN KEY (parceiro_id) REFERENCES parceiro(id) ON DELETE CASCADE;

CREATE TABLE forma_pagamento (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id      uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    codigo          varchar(30) NOT NULL,
    nome            varchar(120) NOT NULL,
    metodo          enum_metodo_pagamento NOT NULL,
    conta_bancaria_padrao_id uuid,     -- FK em 02
    ativo           boolean NOT NULL DEFAULT true,
    criado_em       timestamptz NOT NULL DEFAULT now(),
    atualizado_em   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_forma_pagamento UNIQUE (empresa_id, codigo)
);

CREATE TABLE condicao_pagamento (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id          uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    codigo              varchar(30) NOT NULL,
    nome                varchar(120) NOT NULL,
    quantidade_parcelas smallint NOT NULL DEFAULT 1,
    intervalo_dias      smallint NOT NULL DEFAULT 30,
    dias_primeira_parcela smallint NOT NULL DEFAULT 30,
    percentual_desconto dom_percentual NOT NULL DEFAULT 0,
    ativo               boolean NOT NULL DEFAULT true,
    criado_em           timestamptz NOT NULL DEFAULT now(),
    atualizado_em       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_condicao_pagamento UNIQUE (empresa_id, codigo),
    CONSTRAINT ck_condicao_parcelas CHECK (quantidade_parcelas > 0)
);

CREATE TABLE cliente (
    parceiro_id             uuid PRIMARY KEY REFERENCES parceiro(id) ON DELETE CASCADE,
    empresa_id              uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    limite_credito          dom_valor NOT NULL DEFAULT 0,
    condicao_pagamento_id   uuid REFERENCES condicao_pagamento(id) ON DELETE SET NULL,
    forma_pagamento_id      uuid REFERENCES forma_pagamento(id)    ON DELETE SET NULL,
    vendedor_id             uuid REFERENCES funcionario(id) ON DELETE SET NULL,
    dia_vencimento_preferencial smallint,
    bloqueado               boolean NOT NULL DEFAULT false,
    motivo_bloqueio         text,
    criado_em               timestamptz NOT NULL DEFAULT now(),
    atualizado_em           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_cliente_dia CHECK (dia_vencimento_preferencial IS NULL OR dia_vencimento_preferencial BETWEEN 1 AND 31)
);

CREATE TABLE fornecedor (
    parceiro_id             uuid PRIMARY KEY REFERENCES parceiro(id) ON DELETE CASCADE,
    empresa_id              uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    condicao_pagamento_id   uuid REFERENCES condicao_pagamento(id) ON DELETE SET NULL,
    forma_pagamento_id      uuid REFERENCES forma_pagamento(id)    ON DELETE SET NULL,
    prazo_entrega_dias      smallint,
    categoria_financeira_padrao_id uuid REFERENCES categoria_financeira(id) ON DELETE SET NULL,
    homologado              boolean NOT NULL DEFAULT false,
    bloqueado               boolean NOT NULL DEFAULT false,
    motivo_bloqueio         text,
    criado_em               timestamptz NOT NULL DEFAULT now(),
    atualizado_em           timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- M05 - PRODUTOS, SERVICOS E ESTOQUE                   (RF-028 a RF-035)
-- =============================================================================

CREATE TABLE unidade_medida (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id  uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    sigla       varchar(6) NOT NULL,
    descricao   varchar(60) NOT NULL,
    ativo       boolean NOT NULL DEFAULT true,
    CONSTRAINT uq_unidade_medida UNIQUE (empresa_id, sigla)
);

CREATE TABLE categoria_produto (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id          uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    categoria_pai_id    uuid REFERENCES categoria_produto(id) ON DELETE RESTRICT,
    codigo              varchar(30) NOT NULL,
    nome                varchar(255) NOT NULL,
    ativo               boolean NOT NULL DEFAULT true,
    criado_em           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_categoria_produto UNIQUE (empresa_id, codigo)
);

CREATE TABLE produto (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id              uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    tipo                    enum_tipo_item NOT NULL DEFAULT 'PRODUTO',
    codigo                  varchar(60) NOT NULL,
    codigo_barras           varchar(30),
    descricao               varchar(255) NOT NULL,
    descricao_complementar  text,
    categoria_produto_id    uuid REFERENCES categoria_produto(id) ON DELETE SET NULL,
    unidade_medida_id       uuid REFERENCES unidade_medida(id)    ON DELETE SET NULL,
    -- Dados fiscais (RF-030)
    ncm                     varchar(8),
    cest                    varchar(7),
    cfop_padrao_entrada     varchar(4),
    cfop_padrao_saida       varchar(4),
    origem_mercadoria       smallint,
    codigo_servico_lc116    varchar(10),
    -- Precificacao (RF-029 / RF-034)
    custo_medio             dom_valor_unit NOT NULL DEFAULT 0,
    custo_ultima_compra     dom_valor_unit,
    data_ultima_compra      date,
    preco_venda             dom_valor_unit,
    margem_padrao           dom_percentual,
    -- Estoque (RF-035)
    controla_estoque        boolean NOT NULL DEFAULT true,
    estoque_minimo          dom_quantidade NOT NULL DEFAULT 0,
    estoque_maximo          dom_quantidade,
    peso_liquido            numeric(14,4),
    peso_bruto              numeric(14,4),
    ativo                   boolean NOT NULL DEFAULT true,
    criado_em               timestamptz NOT NULL DEFAULT now(),
    atualizado_em           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_produto_codigo UNIQUE (empresa_id, codigo),
    CONSTRAINT ck_produto_ncm CHECK (ncm IS NULL OR ncm ~ '^[0-9]{8}$'),
    CONSTRAINT ck_produto_estoque CHECK (estoque_maximo IS NULL OR estoque_maximo >= estoque_minimo),
    CONSTRAINT ck_produto_servico_estoque CHECK (NOT (tipo = 'SERVICO' AND controla_estoque))
);
CREATE INDEX ix_produto_empresa ON produto (empresa_id) WHERE ativo;
CREATE INDEX ix_produto_descricao_trgm ON produto USING gin (descricao gin_trgm_ops);
CREATE UNIQUE INDEX ux_produto_barras ON produto (empresa_id, codigo_barras) WHERE codigo_barras IS NOT NULL;

-- Fornecedores por produto (RF-027)
CREATE TABLE produto_fornecedor (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id          uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    produto_id          uuid NOT NULL REFERENCES produto(id)  ON DELETE CASCADE,
    parceiro_id         uuid NOT NULL REFERENCES parceiro(id) ON DELETE CASCADE,
    codigo_no_fornecedor varchar(60),
    preco_referencia    dom_valor_unit,
    prazo_entrega_dias  smallint,
    preferencial        boolean NOT NULL DEFAULT false,
    criado_em           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_produto_fornecedor UNIQUE (produto_id, parceiro_id)
);

CREATE TABLE local_estoque (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id      uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    filial_id       uuid NOT NULL REFERENCES filial(id)  ON DELETE CASCADE,
    codigo          varchar(30) NOT NULL,
    nome            varchar(255) NOT NULL,
    padrao          boolean NOT NULL DEFAULT false,
    ativo           boolean NOT NULL DEFAULT true,
    criado_em       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_local_estoque UNIQUE (empresa_id, codigo)
);

-- Saldo consolidado por produto/local (RF-031)
CREATE TABLE estoque_saldo (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id          uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    produto_id          uuid NOT NULL REFERENCES produto(id)       ON DELETE CASCADE,
    local_estoque_id    uuid NOT NULL REFERENCES local_estoque(id) ON DELETE CASCADE,
    quantidade          dom_quantidade NOT NULL DEFAULT 0,
    quantidade_reservada dom_quantidade NOT NULL DEFAULT 0,
    custo_medio         dom_valor_unit NOT NULL DEFAULT 0,
    valor_total         dom_valor NOT NULL DEFAULT 0,
    atualizado_em       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_estoque_saldo UNIQUE (produto_id, local_estoque_id)
);
CREATE INDEX ix_estoque_saldo_empresa ON estoque_saldo (empresa_id);

-- Movimentacao (RF-032) - livro razao do estoque, append-only
CREATE TABLE movimento_estoque (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id          uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    produto_id          uuid NOT NULL REFERENCES produto(id)       ON DELETE RESTRICT,
    local_estoque_id    uuid NOT NULL REFERENCES local_estoque(id) ON DELETE RESTRICT,
    local_destino_id    uuid REFERENCES local_estoque(id) ON DELETE RESTRICT,
    tipo                enum_tipo_mov_estoque NOT NULL,
    data_movimento      timestamptz NOT NULL DEFAULT now(),
    quantidade          dom_quantidade NOT NULL,
    custo_unitario      dom_valor_unit NOT NULL DEFAULT 0,
    valor_total         dom_valor NOT NULL DEFAULT 0,
    saldo_anterior      dom_quantidade,
    saldo_posterior     dom_quantidade,
    origem_tipo         varchar(40),     -- RECEBIMENTO, DOCUMENTO_FISCAL, AJUSTE, INVENTARIO
    origem_id           uuid,
    lote                varchar(60),
    documento_fiscal_id uuid,            -- FK em 02
    observacao          text,
    usuario_id          uuid REFERENCES usuario(id) ON DELETE SET NULL,
    criado_em           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_movimento_quantidade CHECK (quantidade > 0),
    CONSTRAINT ck_movimento_transferencia CHECK (
        (tipo IN ('TRANSFERENCIA_ENTRADA','TRANSFERENCIA_SAIDA') AND local_destino_id IS NOT NULL)
        OR (tipo NOT IN ('TRANSFERENCIA_ENTRADA','TRANSFERENCIA_SAIDA'))
    )
);
CREATE INDEX ix_movimento_estoque_produto ON movimento_estoque (produto_id, data_movimento DESC);
CREATE INDEX ix_movimento_estoque_origem  ON movimento_estoque (empresa_id, origem_tipo, origem_id);

-- Inventario (RF-033)
CREATE TABLE inventario (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id          uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    local_estoque_id    uuid NOT NULL REFERENCES local_estoque(id) ON DELETE RESTRICT,
    numero              varchar(30) NOT NULL,
    descricao           varchar(255),
    data_inicio         timestamptz NOT NULL DEFAULT now(),
    data_conclusao      timestamptz,
    status              varchar(20) NOT NULL DEFAULT 'ABERTO',
    responsavel_id      uuid REFERENCES usuario(id) ON DELETE SET NULL,
    criado_em           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_inventario_numero UNIQUE (empresa_id, numero)
);

CREATE TABLE inventario_item (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id          uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    inventario_id       uuid NOT NULL REFERENCES inventario(id) ON DELETE CASCADE,
    produto_id          uuid NOT NULL REFERENCES produto(id) ON DELETE RESTRICT,
    quantidade_sistema  dom_quantidade NOT NULL DEFAULT 0,
    quantidade_contada  dom_quantidade,
    diferenca           dom_quantidade GENERATED ALWAYS AS (coalesce(quantidade_contada,0) - quantidade_sistema) STORED,
    custo_unitario      dom_valor_unit,
    ajustado            boolean NOT NULL DEFAULT false,
    observacao          text,
    CONSTRAINT uq_inventario_item UNIQUE (inventario_id, produto_id)
);

-- Alerta de estoque minimo (RF-035)
CREATE OR REPLACE VIEW vw_estoque_alerta_minimo AS
SELECT s.empresa_id,
       s.produto_id,
       p.codigo,
       p.descricao,
       s.local_estoque_id,
       l.nome AS local_nome,
       s.quantidade,
       p.estoque_minimo,
       (p.estoque_minimo - s.quantidade) AS quantidade_repor
FROM estoque_saldo s
JOIN produto p       ON p.id = s.produto_id
JOIN local_estoque l ON l.id = s.local_estoque_id
WHERE p.controla_estoque
  AND p.ativo
  AND p.estoque_minimo > 0
  AND s.quantidade <= p.estoque_minimo;
