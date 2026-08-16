SET search_path = gestao, public;
\set ON_ERROR_STOP on

-- Contexto de sessao
INSERT INTO empresa (id, razao_social, tipo_pessoa, cnpj)
VALUES ('11111111-1111-1111-1111-111111111111','Empresa Teste LTDA','PJ','12345678000199');
SET app.empresa_id = '11111111-1111-1111-1111-111111111111';

INSERT INTO usuario (id, nome, email, senha_hash)
VALUES ('22222222-2222-2222-2222-222222222222','Admin','admin@teste.com','$argon2id$fake');
SET app.usuario_id = '22222222-2222-2222-2222-222222222222';

INSERT INTO filial (id, empresa_id, codigo, nome, matriz)
VALUES ('33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111','001','Matriz',true);

INSERT INTO parceiro (id, empresa_id, tipo_pessoa, razao_social, cnpj, eh_fornecedor)
VALUES ('44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111','PJ','Fornecedor X','98765432000188',true);

INSERT INTO local_estoque (id, empresa_id, filial_id, codigo, nome)
VALUES ('55555555-5555-5555-5555-555555555555','11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333','ALM01','Almoxarifado');

INSERT INTO produto (id, empresa_id, codigo, descricao, ncm, estoque_minimo)
VALUES ('66666666-6666-6666-6666-666666666666','11111111-1111-1111-1111-111111111111','P001','Parafuso M8','73181500',50);

-- Estoque: duas entradas com custos distintos -> custo medio ponderado
INSERT INTO movimento_estoque (empresa_id, produto_id, local_estoque_id, tipo, quantidade, custo_unitario, valor_total)
VALUES ('11111111-1111-1111-1111-111111111111','66666666-6666-6666-6666-666666666666','55555555-5555-5555-5555-555555555555','ENTRADA',100,2.00,200.00),
       ('11111111-1111-1111-1111-111111111111','66666666-6666-6666-6666-666666666666','55555555-5555-5555-5555-555555555555','ENTRADA',100,4.00,400.00);

\echo '--- estoque_saldo (esperado: 200 un, custo medio 3.00) ---'
SELECT quantidade, custo_medio FROM estoque_saldo;

\echo '--- alerta de estoque minimo (nao deve retornar linhas) ---'
SELECT count(*) AS alertas FROM vw_estoque_alerta_minimo;

-- Titulo a pagar com 2 parcelas.
--
-- Numa transacao so: desde bd/09, a igualdade "parcelas somam o titulo" e uma
-- constraint trigger adiada para o commit (RF-053). Um titulo comitado sozinho,
-- sem parcela nenhuma, e justamente o que ela recusa.
BEGIN;
INSERT INTO titulo (id, empresa_id, tipo, numero, parceiro_id, descricao, valor_bruto, valor_liquido, saldo)
VALUES ('77777777-7777-7777-7777-777777777777','11111111-1111-1111-1111-111111111111','PAGAR','CP-0001',
        '44444444-4444-4444-4444-444444444444','Compra de material',1000.00,1000.00,1000.00);

INSERT INTO titulo_parcela (id, empresa_id, titulo_id, numero_parcela, total_parcelas, data_vencimento, valor, saldo)
VALUES ('88888888-8888-8888-8888-888888888888','11111111-1111-1111-1111-111111111111','77777777-7777-7777-7777-777777777777',1,2,current_date+30,500.00,500.00),
       ('99999999-9999-9999-9999-999999999999','11111111-1111-1111-1111-111111111111','77777777-7777-7777-7777-777777777777',2,2,current_date+60,500.00,500.00);
COMMIT;

-- Baixa parcial da parcela 1
INSERT INTO titulo_baixa (empresa_id, titulo_parcela_id, valor_principal, valor_total)
VALUES ('11111111-1111-1111-1111-111111111111','88888888-8888-8888-8888-888888888888',200.00,200.00);

\echo '--- parcela 1 apos baixa parcial (esperado: liquidado 200, saldo 300, PARCIALMENTE_LIQUIDADA) ---'
SELECT numero_parcela, valor_liquidado, saldo, status FROM titulo_parcela WHERE id='88888888-8888-8888-8888-888888888888';

-- Quita o restante da parcela 1
INSERT INTO titulo_baixa (empresa_id, titulo_parcela_id, valor_principal, valor_total)
VALUES ('11111111-1111-1111-1111-111111111111','88888888-8888-8888-8888-888888888888',300.00,300.00);

\echo '--- titulo apos quitacao da parcela 1 (esperado: liquidado 500, PARCIALMENTE_LIQUIDADO) ---'
SELECT valor_liquidado, saldo, status FROM titulo WHERE id='77777777-7777-7777-7777-777777777777';

-- Fluxo de caixa (M14): o realizado sai das baixas, na data em que o dinheiro
-- andou; o previsto, das parcelas em aberto, na data em que ainda vai andar.
\echo '--- fluxo de caixa (esperado: REALIZADO 500 hoje e PREVISTO 500 em +60) ---'
SELECT situacao, data_referencia, sum(valor) AS valor
  FROM vw_fluxo_caixa
 WHERE cenario_id IS NULL
 GROUP BY situacao, data_referencia
 ORDER BY data_referencia;

-- Cenario com projecao manual (RF-104)
INSERT INTO cenario_fluxo_caixa (id, empresa_id, nome, data_inicio, data_fim, saldo_inicial, premissas, base)
VALUES ('cccccccc-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
        'Base', current_date, current_date + 90, 1000.00, '{"entradas_percentual": -10}'::jsonb, true);

INSERT INTO projecao_fluxo_caixa (empresa_id, cenario_id, data_referencia, tipo, situacao, valor, descricao)
VALUES ('11111111-1111-1111-1111-111111111111','cccccccc-0000-0000-0000-000000000001',
        current_date + 45,'RECEBER','PREVISTO',2500.00,'Venda prevista');

\echo '--- projecao manual do cenario (esperado: 1 linha, manual = t) ---'
SELECT count(*) AS projecoes, bool_and(manual) AS todas_manuais
  FROM vw_fluxo_caixa WHERE cenario_id = 'cccccccc-0000-0000-0000-000000000001';

\echo '--- teste: projecao fora da janela do cenario deve falhar ---'
DO $$
BEGIN
    INSERT INTO projecao_fluxo_caixa (empresa_id, cenario_id, data_referencia, tipo, situacao, valor)
    VALUES ('11111111-1111-1111-1111-111111111111','cccccccc-0000-0000-0000-000000000001',
            current_date + 400,'PAGAR','PREVISTO',100.00);
    RAISE WARNING 'FALHA: a projecao fora da janela do cenario foi aceita (RF-104).';
EXCEPTION WHEN others THEN
    RAISE NOTICE 'OK: %', SQLERRM;
END $$;

-- Contabilidade
INSERT INTO conta_contabil (id, empresa_id, codigo, nome, tipo, natureza, nivel, aceita_lancamento) VALUES
 ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','1.1.01.001','Caixa','ATIVO','DEVEDORA',4,true),
 ('aaaaaaaa-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','4.1.01.001','Despesa Material','DESPESA','DEVEDORA',4,true),
 ('aaaaaaaa-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','1.1','Ativo Circulante','ATIVO','DEVEDORA',2,false);

INSERT INTO periodo_contabil (empresa_id, exercicio, mes, data_inicio, data_fim)
VALUES ('11111111-1111-1111-1111-111111111111', extract(year from current_date)::smallint,
        extract(month from current_date)::smallint, date_trunc('month',current_date)::date,
        (date_trunc('month',current_date) + interval '1 month - 1 day')::date);

BEGIN;
INSERT INTO lancamento_contabil (id, empresa_id, data_lancamento, data_competencia, historico, valor_total)
VALUES ('bbbbbbbb-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',current_date,current_date,'Pagamento fornecedor',500.00);
INSERT INTO lancamento_partida (empresa_id, lancamento_contabil_id, sequencia, conta_contabil_id, tipo, valor) VALUES
 ('11111111-1111-1111-1111-111111111111','bbbbbbbb-0000-0000-0000-000000000001',1,'aaaaaaaa-0000-0000-0000-000000000002','DEBITO',500.00),
 ('11111111-1111-1111-1111-111111111111','bbbbbbbb-0000-0000-0000-000000000001',2,'aaaaaaaa-0000-0000-0000-000000000001','CREDITO',500.00);
COMMIT;
\echo '--- lancamento balanceado gravado ---'
SELECT count(*) AS partidas FROM lancamento_partida;

\echo '--- teste: lancamento desbalanceado deve falhar ---'
BEGIN;
INSERT INTO lancamento_contabil (id, empresa_id, data_lancamento, data_competencia, historico, valor_total)
VALUES ('bbbbbbbb-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111',current_date,current_date,'Erro',100.00);
INSERT INTO lancamento_partida (empresa_id, lancamento_contabil_id, sequencia, conta_contabil_id, tipo, valor)
VALUES ('11111111-1111-1111-1111-111111111111','bbbbbbbb-0000-0000-0000-000000000002',1,'aaaaaaaa-0000-0000-0000-000000000001','DEBITO',100.00);
COMMIT;
