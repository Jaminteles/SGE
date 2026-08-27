-- =============================================================================
-- 19_relatorios_sprint16.sql
-- Sprint 16 - Fase 8 (Gestao Avancada): M15 - Relatorios e Dashboards
-- (RF-106 a RF-113).
--
-- Executar como gestao_owner, depois de 01 a 18:
--   psql -U gestao_owner -h localhost -d gestao_empresarial -f 19_relatorios_sprint16.sql
-- Idempotente: pode ser reexecutado.
--
-- Este script **nao cria nenhuma tabela nova**. O M15 nao tem dado proprio: o
-- dashboard e a leitura agregada do que os modulos anteriores ja gravaram. Toda
-- tabela nova aqui seria uma segunda versao do numero -- uma que envelhece
-- sozinha e passa a discordar da origem no pior momento, que e a reuniao em que
-- alguem decide com base nela.
--
-- O que entra:
--   1. RF-107 - carteira agregada por vencimento, faixa de atraso e classificacao
--   2. RF-106/RF-108 - realizado por dia, a partir das baixas efetivas
--   3. RF-109 - compras por competencia, status e fornecedor
--   4. RF-109 - desempenho do fornecedor: prazo, divergencia e volume
--   5. RF-109 - estoque valorizado e a posicao contra o minimo
--   6. RF-110 - quadro de pessoal por lotacao, e sua movimentacao mensal
--   7. RF-110 - centro de custo: o provisionado e o realizado, lado a lado
--   8. RF-112 - indices que sustentam o recorte por periodo
--
-- Duas decisoes valem para as sete views:
--
--   a) **security_invoker**. Sem ele a view roda com a RLS do dono do schema, e
--      o dashboard de uma empresa mostraria o movimento de todas. As colunas
--      `empresa_id` que sobem para a API sao defesa em profundidade, nao o
--      isolamento;
--   b) **o estornado nao conta**. Baixa estornada e a propria linha de estorno
--      ficam de fora do realizado: somar as duas dobraria o recebimento do dia,
--      e somar so uma delas produziria um caixa que nunca existiu.
-- =============================================================================

SET search_path TO gestao, public;

-- -----------------------------------------------------------------------------
-- 1. RF-107: carteira a pagar e a receber, agregada
--
-- Sai de `vw_parcela_posicao` (09) e nao de `titulo`: a pergunta do dashboard e
-- sobre vencimento, e vencimento e da parcela. Um titulo de doze parcelas nao
-- vence -- vencem as parcelas dele, uma por mes, e a metade que ja foi paga nao
-- e mais carteira.
--
-- `valor_atualizado` ja vem com juros e multa calculados pela funcao do modelo,
-- entao a tela nao recalcula encargo nenhum: dois calculos do mesmo encargo em
-- lugares diferentes divergem, e o que o cliente ve na cobranca precisa ser o
-- mesmo que o gestor ve no painel.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS vw_indicador_carteira;

CREATE VIEW vw_indicador_carteira AS
SELECT p.empresa_id,
       p.filial_id,
       p.tipo,
       p.status,
       p.faixa_atraso,
       p.categoria_financeira_id,
       p.centro_custo_id,
       p.parceiro_id,
       date_trunc('month', p.data_vencimento)::date AS competencia,
       p.data_vencimento,
       count(*)                        AS parcelas,
       sum(p.valor)                    AS valor_original,
       sum(p.saldo)                    AS saldo,
       sum(p.encargos)                 AS encargos,
       sum(p.valor_atualizado)         AS valor_atualizado,
       max(p.dias_atraso)              AS maior_atraso
  FROM vw_parcela_posicao p
 GROUP BY p.empresa_id, p.filial_id, p.tipo, p.status, p.faixa_atraso,
          p.categoria_financeira_id, p.centro_custo_id, p.parceiro_id,
          date_trunc('month', p.data_vencimento), p.data_vencimento;

COMMENT ON VIEW vw_indicador_carteira IS
    'RF-107 - carteira em aberto por vencimento, faixa de atraso e classificacao; encargos vem do modelo.';

-- -----------------------------------------------------------------------------
-- 2. RF-106 / RF-108: realizado por dia
--
-- O caixa realizado e a baixa, nao o titulo: titulo diz o que se espera, baixa
-- diz o que entrou. `vw_fluxo_caixa` (10) ja mistura realizado, previsto e
-- projetado para o planejamento; aqui a pergunta e outra -- quanto de fato
-- circulou, com juros, multa e desconto separados, que e o que reconcilia com o
-- extrato.
--
-- Juros e multa recebidos nao sao receita da operacao e desconto concedido nao e
-- despesa: mantidos em colunas proprias, quem le decide se soma. Achatar tudo em
-- `valor_total` esconderia que o mes fechou no azul as custas de encargo de
-- atraso.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS vw_indicador_realizado;

CREATE VIEW vw_indicador_realizado AS
SELECT b.empresa_id,
       t.filial_id,
       t.tipo,
       b.data_baixa,
       date_trunc('month', b.data_baixa)::date AS competencia,
       t.categoria_financeira_id,
       t.centro_custo_id,
       t.parceiro_id,
       b.conta_bancaria_id,
       b.forma_pagamento_id,
       count(*)                   AS baixas,
       sum(b.valor_principal)     AS valor_principal,
       sum(b.valor_juros)         AS valor_juros,
       sum(b.valor_multa)         AS valor_multa,
       sum(b.valor_desconto)      AS valor_desconto,
       sum(b.valor_total)         AS valor_total
  FROM titulo_baixa b
  JOIN titulo_parcela p ON p.id = b.titulo_parcela_id
  JOIN titulo t         ON t.id = p.titulo_id
 WHERE NOT b.estornada
   AND b.estorno_de_id IS NULL
 GROUP BY b.empresa_id, t.filial_id, t.tipo, b.data_baixa,
          date_trunc('month', b.data_baixa), t.categoria_financeira_id,
          t.centro_custo_id, t.parceiro_id, b.conta_bancaria_id, b.forma_pagamento_id;

COMMENT ON VIEW vw_indicador_realizado IS
    'RF-106/RF-108 - baixas efetivas por dia, com juros, multa e desconto separados. Estorno e baixa estornada ficam de fora.';

-- -----------------------------------------------------------------------------
-- 3. RF-109: compras por competencia
--
-- `status` e dimensao, e nao filtro embutido: pedido cancelado interessa para
-- medir cancelamento, e um pedido em aprovacao e compromisso que ainda pode ser
-- evitado. Excluir aqui obrigaria uma segunda view para responder isso.
--
-- A competencia e `data_pedido`. A entrega tem data propria e vive na view do
-- fornecedor, logo abaixo.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS vw_indicador_compras;

CREATE VIEW vw_indicador_compras AS
SELECT c.empresa_id,
       c.filial_id,
       c.status,
       c.status_aprovacao,
       c.parceiro_id,
       c.centro_custo_id,
       c.categoria_financeira_id,
       date_trunc('month', c.data_pedido)::date AS competencia,
       count(*)                    AS pedidos,
       sum(c.valor_produtos)       AS valor_produtos,
       sum(c.valor_desconto)       AS valor_desconto,
       sum(c.valor_frete)          AS valor_frete,
       sum(c.valor_total)          AS valor_total
  FROM pedido_compra c
 GROUP BY c.empresa_id, c.filial_id, c.status, c.status_aprovacao, c.parceiro_id,
          c.centro_custo_id, c.categoria_financeira_id,
          date_trunc('month', c.data_pedido);

COMMENT ON VIEW vw_indicador_compras IS
    'RF-109 - pedidos de compra por competencia, status e fornecedor. Status e dimensao, nao filtro.';

-- -----------------------------------------------------------------------------
-- 4. RF-109: desempenho do fornecedor
--
-- Tres numeros decidem se um fornecedor continua: quanto se compra dele, se ele
-- entrega no prazo e se o que chega confere. O prazo sai da distancia entre o
-- pedido e o recebimento, e nao da previsao -- previsao e promessa, recebimento
-- e fato.
--
-- O LEFT JOIN e proposital: fornecedor com pedido e sem recebimento e
-- exatamente o caso que precisa aparecer. Com INNER JOIN ele sumiria do
-- relatorio no momento em que passou a merecer atencao. Pelo mesmo motivo
-- `valor_total` soma o pedido uma vez so (subconsulta), e nao uma vez por
-- recebimento parcial: tres entregas de um pedido nao sao tres compras.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS vw_indicador_fornecedor;

CREATE VIEW vw_indicador_fornecedor AS
SELECT c.empresa_id,
       c.parceiro_id,
       date_trunc('month', c.data_pedido)::date AS competencia,
       count(*)                                          AS pedidos,
       sum(c.valor_total)                                AS valor_total,
       sum(c.recebimentos)                               AS recebimentos,
       sum(c.recebimentos_divergentes)                   AS recebimentos_divergentes,
       avg(c.prazo_medio_dias) FILTER (WHERE c.prazo_medio_dias IS NOT NULL)
                                                         AS prazo_medio_dias,
       max(c.maior_atraso_entrega)                       AS maior_atraso_entrega
  FROM (
        SELECT p.empresa_id,
               p.parceiro_id,
               p.data_pedido,
               p.valor_total,
               count(r.id)                                     AS recebimentos,
               count(r.id) FILTER (WHERE r.possui_divergencia)  AS recebimentos_divergentes,
               avg(r.data_recebimento::date - p.data_pedido)    AS prazo_medio_dias,
               max(r.data_recebimento::date - p.data_previsao_entrega)
                   FILTER (WHERE p.data_previsao_entrega IS NOT NULL)
                                                               AS maior_atraso_entrega
          FROM pedido_compra p
          LEFT JOIN recebimento r ON r.pedido_compra_id = p.id
         WHERE p.status <> 'CANCELADO'
         GROUP BY p.id, p.empresa_id, p.parceiro_id, p.data_pedido, p.valor_total
       ) c
 GROUP BY c.empresa_id, c.parceiro_id, date_trunc('month', c.data_pedido);

COMMENT ON VIEW vw_indicador_fornecedor IS
    'RF-109 - volume, prazo medio real e divergencia por fornecedor. Pedido sem recebimento continua na linha.';

-- -----------------------------------------------------------------------------
-- 5. RF-109: estoque valorizado
--
-- A filial vem do local de estoque, que a tem obrigatoria (01) -- `estoque_saldo`
-- nao guarda filial, e deduzi-la pelo produto daria a filial errada para quem
-- opera dois depositos.
--
-- `abaixo_minimo` reusa a mesma condicao de `vw_estoque_alerta_minimo` (01) em
-- vez de reimplementa-la: duas definicoes de "abaixo do minimo" acabam
-- divergindo, e o alerta que dispara precisa ser o mesmo que o painel conta.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS vw_indicador_estoque;

CREATE VIEW vw_indicador_estoque AS
SELECT s.empresa_id,
       l.filial_id,
       s.local_estoque_id,
       p.categoria_produto_id,
       count(*)                                         AS itens,
       sum(s.quantidade)                                AS quantidade,
       sum(s.quantidade_reservada)                      AS quantidade_reservada,
       sum(s.valor_total)                               AS valor_total,
       count(*) FILTER (WHERE a.produto_id IS NOT NULL) AS itens_abaixo_minimo,
       coalesce(sum(a.quantidade_repor), 0)             AS quantidade_repor
  FROM estoque_saldo s
  JOIN produto p       ON p.id = s.produto_id
  JOIN local_estoque l ON l.id = s.local_estoque_id
  LEFT JOIN vw_estoque_alerta_minimo a
         ON a.produto_id = s.produto_id
        AND a.local_estoque_id = s.local_estoque_id
 GROUP BY s.empresa_id, l.filial_id, s.local_estoque_id, p.categoria_produto_id;

COMMENT ON VIEW vw_indicador_estoque IS
    'RF-109 - estoque valorizado por local e categoria, com a contagem abaixo do minimo vinda do alerta de 01.';

-- -----------------------------------------------------------------------------
-- 6. RF-110: quadro de pessoal e sua movimentacao
--
-- Duas views porque sao duas perguntas. "Quantos somos e quanto custa a folha
-- base" e uma foto do agora; "quantos entraram e sairam em marco" e um filme, e
-- so responde por competencia.
--
-- `salario_base` pode ser nulo (01) e `sum` ignora nulo, mas `count(*)` nao:
-- sem o FILTER, uma equipe com metade dos salarios em branco daria media de
-- folha pela metade. Por isso `funcionarios_com_salario` sobe junto -- quem le
-- precisa saber sobre quantas pessoas o total foi apurado.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS vw_indicador_quadro;

CREATE VIEW vw_indicador_quadro AS
SELECT f.empresa_id,
       f.filial_id,
       f.departamento_id,
       f.cargo_id,
       f.centro_custo_id,
       f.status,
       count(*)                                           AS funcionarios,
       count(*) FILTER (WHERE f.salario_base IS NOT NULL) AS funcionarios_com_salario,
       coalesce(sum(f.salario_base), 0)                   AS salario_base_total,
       min(f.data_admissao)                               AS admissao_mais_antiga
  FROM funcionario f
 GROUP BY f.empresa_id, f.filial_id, f.departamento_id, f.cargo_id,
          f.centro_custo_id, f.status;

COMMENT ON VIEW vw_indicador_quadro IS
    'RF-110 - quadro de pessoal por lotacao e situacao, com a folha base do grupo.';

DROP VIEW IF EXISTS vw_indicador_quadro_movimento;

CREATE VIEW vw_indicador_quadro_movimento AS
SELECT empresa_id, filial_id, departamento_id, centro_custo_id, competencia,
       sum(admissoes)     AS admissoes,
       sum(desligamentos) AS desligamentos
  FROM (
        SELECT f.empresa_id, f.filial_id, f.departamento_id, f.centro_custo_id,
               date_trunc('month', f.data_admissao)::date AS competencia,
               1 AS admissoes, 0 AS desligamentos
          FROM funcionario f
         UNION ALL
        SELECT f.empresa_id, f.filial_id, f.departamento_id, f.centro_custo_id,
               date_trunc('month', f.data_desligamento)::date,
               0, 1
          FROM funcionario f
         WHERE f.data_desligamento IS NOT NULL
       ) m
 GROUP BY empresa_id, filial_id, departamento_id, centro_custo_id, competencia;

COMMENT ON VIEW vw_indicador_quadro_movimento IS
    'RF-110 - admissoes e desligamentos por competencia e lotacao.';

-- -----------------------------------------------------------------------------
-- 7. RF-110: centro de custo -- provisionado contra realizado
--
-- As duas metades vem de datas diferentes de proposito. O provisionado usa
-- `data_competencia` do titulo, que e onde a despesa pertence; o realizado usa
-- `data_baixa`, que e quando o dinheiro saiu. Usar a mesma data para os dois
-- apagaria justamente a diferenca que o gestor quer ver -- o mes em que o custo
-- ocorreu e o mes em que ele foi pago raramente sao o mesmo.
--
-- Titulo cancelado nao entra no provisionado: ele nao e compromisso de nada.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS vw_indicador_centro_custo;

CREATE VIEW vw_indicador_centro_custo AS
SELECT empresa_id, filial_id, centro_custo_id, tipo, competencia,
       sum(valor_provisionado) AS valor_provisionado,
       sum(valor_realizado)    AS valor_realizado
  FROM (
        SELECT t.empresa_id, t.filial_id, t.centro_custo_id, t.tipo,
               date_trunc('month', t.data_competencia)::date AS competencia,
               t.valor_liquido  AS valor_provisionado,
               0::numeric(18,2) AS valor_realizado
          FROM titulo t
         WHERE t.status <> 'CANCELADO'
         UNION ALL
        SELECT b.empresa_id, t.filial_id, t.centro_custo_id, t.tipo,
               date_trunc('month', b.data_baixa)::date,
               0::numeric(18,2),
               b.valor_total
          FROM titulo_baixa b
          JOIN titulo_parcela p ON p.id = b.titulo_parcela_id
          JOIN titulo t         ON t.id = p.titulo_id
         WHERE NOT b.estornada
           AND b.estorno_de_id IS NULL
       ) c
 GROUP BY empresa_id, filial_id, centro_custo_id, tipo, competencia;

COMMENT ON VIEW vw_indicador_centro_custo IS
    'RF-110 - centro de custo por competencia: provisionado pela competencia do titulo, realizado pela data da baixa.';

-- -----------------------------------------------------------------------------
-- RLS das views: a do chamador, nunca a do dono do schema.
-- -----------------------------------------------------------------------------
DO $$
DECLARE v text;
BEGIN
    IF current_setting('server_version_num')::int >= 150000 THEN
        FOREACH v IN ARRAY ARRAY[
            'vw_indicador_carteira','vw_indicador_realizado','vw_indicador_compras',
            'vw_indicador_fornecedor','vw_indicador_estoque','vw_indicador_quadro',
            'vw_indicador_quadro_movimento','vw_indicador_centro_custo'
        ] LOOP
            EXECUTE format('ALTER VIEW gestao.%I SET (security_invoker = true)', v);
        END LOOP;
    ELSE
        RAISE NOTICE 'PostgreSQL < 15: views do M15 seguem com RLS do owner (isolamento mantido).';
    END IF;
END $$;

GRANT SELECT ON vw_indicador_carteira, vw_indicador_realizado, vw_indicador_compras,
                vw_indicador_fornecedor, vw_indicador_estoque, vw_indicador_quadro,
                vw_indicador_quadro_movimento, vw_indicador_centro_custo
   TO app_gestao;

-- -----------------------------------------------------------------------------
-- 8. RF-112: indices do recorte por periodo
--
-- Todo filtro do M15 comeca por empresa e periodo. Sem estes indices, cada
-- abertura do dashboard vira sequential scan nas tabelas que mais crescem --
-- baixas, titulos e pedidos -- e o painel fica lento exatamente na empresa que
-- tem historico para analisar.
--
-- `titulo_baixa` ja tem `ix_titulo_baixa_data` (10) com o mesmo recorte de
-- baixa efetiva; nao se repete aqui.
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS ix_titulo_competencia
    ON titulo (empresa_id, data_competencia) WHERE status <> 'CANCELADO';

CREATE INDEX IF NOT EXISTS ix_pedido_compra_data
    ON pedido_compra (empresa_id, data_pedido);

CREATE INDEX IF NOT EXISTS ix_recebimento_pedido
    ON recebimento (pedido_compra_id) WHERE pedido_compra_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_funcionario_admissao
    ON funcionario (empresa_id, data_admissao);

CREATE INDEX IF NOT EXISTS ix_funcionario_desligamento
    ON funcionario (empresa_id, data_desligamento) WHERE data_desligamento IS NOT NULL;

-- =============================================================================
-- FIM - 19_relatorios_sprint16.sql
-- =============================================================================
