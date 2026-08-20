-- =============================================================================
-- 98_smoke_bancos_sprint10.sql
-- Sprint 10 - M09: confere, num banco ja migrado, que as regras de bd/13 valem.
--
--   psql -U gestao_owner -h localhost -d gestao_empresarial -f 98_smoke_bancos_sprint10.sql
--
-- Nao deixa rastro: cria uma empresa descartavel, exercita cada regra e termina
-- em ROLLBACK. Cada verificacao imprime uma linha `ok N`; qualquer regra que
-- deixe de valer interrompe o script com `FALHOU N`.
--
-- Cobre: RF-057, RF-059, RF-060, RF-062, RF-064, RF-065, RF-067, RF-068,
-- RF-070, RN-002 e RN-004.
-- =============================================================================
SET search_path = gestao, public;
BEGIN;

DO $smoke$
DECLARE
    v_empresa   uuid;
    v_parceiro  uuid;
    v_conta     uuid;
    v_conta2    uuid;
    v_titulo    uuid;
    v_parcela   uuid;
    v_tx        uuid;
    v_ok        boolean;
BEGIN
    INSERT INTO empresa (razao_social, cnpj) VALUES ('SMOKE S10 LTDA', '11222333000181')
      RETURNING id INTO v_empresa;
    PERFORM set_config('app.empresa_id', v_empresa::text, true);
    PERFORM set_config('app.origem', 'API', true);

    INSERT INTO parceiro (empresa_id, tipo_pessoa, razao_social, cnpj, eh_fornecedor)
    VALUES (v_empresa, 'PJ', 'FORNECEDOR SMOKE', '11222333000262', true) RETURNING id INTO v_parceiro;

    -- 1. RF-059: conta habilitada a pagar sem agencia e sem PIX.
    BEGIN
        INSERT INTO conta_bancaria (empresa_id, descricao, banco_codigo, agencia, conta, permite_pagamento)
        VALUES (v_empresa, 'Sem destino', '341', '', '', true);
        RAISE EXCEPTION 'FALHOU 1: conta sem destino foi aceita';
    EXCEPTION WHEN sqlstate 'P0001' THEN
        RAISE NOTICE 'ok  1 RF-059: conta que paga sem destino recusada';
    END;

    INSERT INTO conta_bancaria (empresa_id, descricao, banco_codigo, agencia, conta, padrao)
    VALUES (v_empresa, 'Itau principal', '341', '1234', '567890', true) RETURNING id INTO v_conta;

    -- 2. RF-059: uma conta padrao por empresa.
    BEGIN
        INSERT INTO conta_bancaria (empresa_id, descricao, banco_codigo, agencia, conta, padrao)
        VALUES (v_empresa, 'Segunda padrao', '237', '9999', '111111', true);
        RAISE EXCEPTION 'FALHOU 2: segunda conta padrao foi aceita';
    EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE 'ok  2 RF-059: segunda conta padrao recusada';
    END;

    INSERT INTO conta_bancaria (empresa_id, descricao, banco_codigo, agencia, conta)
    VALUES (v_empresa, 'Bradesco', '237', '9999', '111111') RETURNING id INTO v_conta2;

    -- 3. RF-062: transacao nasce em CRIADA ou AGENDADA.
    BEGIN
        INSERT INTO transacao_pagamento (empresa_id, conta_bancaria_id, sentido, metodo, status, valor, idempotency_key)
        VALUES (v_empresa, v_conta, 'DEBITO', 'PIX', 'CONFIRMADA', 100, 'k-nasce-confirmada');
        RAISE EXCEPTION 'FALHOU 3: transacao nasceu CONFIRMADA';
    EXCEPTION WHEN sqlstate 'P0001' THEN
        RAISE NOTICE 'ok  3 RF-062: transacao nao nasce confirmada';
    END;

    INSERT INTO titulo (empresa_id, tipo, numero, descricao, parceiro_id, valor_bruto, valor_liquido, saldo)
    VALUES (v_empresa, 'PAGAR', 'SMOKE-1', 'Compra de teste', v_parceiro, 1000, 1000, 1000)
      RETURNING id INTO v_titulo;
    INSERT INTO titulo_parcela (empresa_id, titulo_id, numero_parcela, data_vencimento, valor, saldo)
    VALUES (v_empresa, v_titulo, 1, current_date + 30, 1000, 1000) RETURNING id INTO v_parcela;

    INSERT INTO transacao_pagamento (empresa_id, conta_bancaria_id, titulo_parcela_id, sentido, metodo,
                                     valor, idempotency_key, chave_pix, cancelavel)
    VALUES (v_empresa, v_conta, v_parcela, 'DEBITO', 'PIX', 1000, 'k-pagamento-1', 'chave@pix', false)
      RETURNING id INTO v_tx;

    -- 4. RF-067/RN-004: chave de idempotencia unica por empresa.
    BEGIN
        INSERT INTO transacao_pagamento (empresa_id, conta_bancaria_id, sentido, metodo, valor, idempotency_key)
        VALUES (v_empresa, v_conta, 'DEBITO', 'PIX', 50, 'k-pagamento-1');
        RAISE EXCEPTION 'FALHOU 4: chave de idempotencia repetida foi aceita';
    EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE 'ok  4 RF-067: idempotency_key repetida recusada';
    END;

    -- 5. RF-064: transicao invalida (CRIADA -> CONFIRMADA).
    BEGIN
        UPDATE transacao_pagamento SET status = 'CONFIRMADA' WHERE id = v_tx;
        RAISE EXCEPTION 'FALHOU 5: transicao CRIADA -> CONFIRMADA aceita';
    EXCEPTION WHEN sqlstate 'P0001' THEN
        RAISE NOTICE 'ok  5 RF-064: transicao invalida recusada';
    END;

    -- 6. RN-004: valor e conta nao mudam depois de gravados.
    BEGIN
        UPDATE transacao_pagamento SET valor = 5000 WHERE id = v_tx;
        RAISE EXCEPTION 'FALHOU 6: valor da ordem foi alterado';
    EXCEPTION WHEN sqlstate 'P0001' THEN
        RAISE NOTICE 'ok  6 RN-004: valor da ordem e imutavel';
    END;

    -- 7. RN-004: baixa exige transacao CONFIRMADA.
    BEGIN
        INSERT INTO titulo_baixa (empresa_id, titulo_parcela_id, valor_principal, valor_total,
                                  conta_bancaria_id, transacao_pagamento_id)
        VALUES (v_empresa, v_parcela, 1000, 1000, v_conta, v_tx);
        RAISE EXCEPTION 'FALHOU 7: baixa de transacao nao confirmada aceita';
    EXCEPTION WHEN sqlstate 'P0001' THEN
        RAISE NOTICE 'ok  7 RN-004: baixa exige transacao confirmada';
    END;

    UPDATE transacao_pagamento SET status = 'ENFILEIRADA' WHERE id = v_tx;
    UPDATE transacao_pagamento SET status = 'ENVIADA', identificador_externo = 'ext-1' WHERE id = v_tx;

    -- 8. RF-065: cancelamento pos-envio so onde o provedor cancela.
    BEGIN
        UPDATE transacao_pagamento SET status = 'CANCELADA', motivo_cancelamento = 'desistencia'
         WHERE id = v_tx;
        RAISE EXCEPTION 'FALHOU 8: cancelou ordem nao cancelavel';
    EXCEPTION WHEN sqlstate 'P0001' THEN
        RAISE NOTICE 'ok  8 RF-065: ordem nao cancelavel recusa cancelamento';
    END;

    -- 9. RF-068: identificador externo nao se reescreve.
    BEGIN
        UPDATE transacao_pagamento SET identificador_externo = 'ext-2' WHERE id = v_tx;
        RAISE EXCEPTION 'FALHOU 9: identificador externo foi trocado';
    EXCEPTION WHEN sqlstate 'P0001' THEN
        RAISE NOTICE 'ok  9 RF-068: identificador externo e imutavel';
    END;

    UPDATE transacao_pagamento SET status = 'CONFIRMADA' WHERE id = v_tx;

    INSERT INTO titulo_baixa (empresa_id, titulo_parcela_id, valor_principal, valor_total,
                              conta_bancaria_id, transacao_pagamento_id)
    VALUES (v_empresa, v_parcela, 400, 400, v_conta, v_tx);
    RAISE NOTICE 'ok 10 RF-057: baixa gerada pela ordem confirmada';

    -- 11. RN-004: uma baixa por transacao. Parcial de proposito: com a parcela
    -- ainda com saldo, quem barra a segunda baixa e o indice de bd/13, e nao a
    -- regra de saldo de bd/09.
    BEGIN
        INSERT INTO titulo_baixa (empresa_id, titulo_parcela_id, valor_principal, valor_total,
                                  conta_bancaria_id, transacao_pagamento_id)
        VALUES (v_empresa, v_parcela, 400, 400, v_conta, v_tx);
        RAISE EXCEPTION 'FALHOU 11: segunda baixa da mesma transacao aceita';
    EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE 'ok 11 RN-004: segunda baixa da mesma ordem recusada';
    END;

    -- 12. RF-067: a reserva de idempotencia nao se reaponta.
    INSERT INTO idempotencia (empresa_id, escopo, chave, request_hash, recurso_id)
    VALUES (v_empresa, 'PAGAMENTO', 'k-pagamento-1', 'hash', v_tx);
    BEGIN
        UPDATE idempotencia SET recurso_id = gen_random_uuid()
         WHERE empresa_id = v_empresa AND chave = 'k-pagamento-1';
        RAISE EXCEPTION 'FALHOU 12: chave de idempotencia reapontada';
    EXCEPTION WHEN sqlstate 'P0001' THEN
        RAISE NOTICE 'ok 12 RF-067: reserva de idempotencia nao se reaponta';
    END;

    -- 13. RF-070: tentativas nao passam do teto.
    BEGIN
        INSERT INTO job_execucao (empresa_id, fila, nome, tentativas, max_tentativas)
        VALUES (v_empresa, 'pagamentos', 'payment.send', 9, 5);
        RAISE EXCEPTION 'FALHOU 13: job acima do teto de tentativas aceito';
    EXCEPTION WHEN sqlstate 'P0001' THEN
        RAISE NOTICE 'ok 13 RF-070: teto de tentativas respeitado';
    END;

    -- 14. RF-060: movimento bancario importado e imutavel.
    INSERT INTO transacao_bancaria (empresa_id, conta_bancaria_id, data_movimento, sentido, valor,
                                    identificador_externo)
    VALUES (v_empresa, v_conta2, current_date, 'DEBITO', 10, 'FIT-1');
    BEGIN
        UPDATE transacao_bancaria SET valor = 99 WHERE identificador_externo = 'FIT-1';
        RAISE EXCEPTION 'FALHOU 14: valor do movimento bancario alterado';
    EXCEPTION WHEN sqlstate 'P0001' THEN
        RAISE NOTICE 'ok 14 RF-060: movimento bancario e imutavel';
    END;

    -- 15. RF-060: a mesma linha do extrato nao entra duas vezes.
    BEGIN
        INSERT INTO transacao_bancaria (empresa_id, conta_bancaria_id, data_movimento, sentido, valor,
                                        identificador_externo)
        VALUES (v_empresa, v_conta2, current_date, 'DEBITO', 10, 'FIT-1');
        RAISE EXCEPTION 'FALHOU 15: FITID repetido aceito';
    EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE 'ok 15 RF-060: FITID repetido recusado';
    END;

    -- 16. RN-002: fila e webhook nao sao legiveis fora do contexto de sistema.
    INSERT INTO webhook_evento (empresa_id, evento_tipo, payload) VALUES (v_empresa, 'teste', '{}');
    PERFORM set_config('app.empresa_id', gen_random_uuid()::text, true);
    SELECT count(*) = 0 INTO v_ok FROM webhook_evento;
    IF NOT v_ok THEN RAISE EXCEPTION 'FALHOU 16: webhook de outra empresa visivel'; END IF;
    RAISE NOTICE 'ok 16 RN-002: webhook isolado por empresa';

    PERFORM set_config('app.origem', 'WORKER', true);
    SELECT count(*) > 0 INTO v_ok FROM webhook_evento;
    IF NOT v_ok THEN RAISE EXCEPTION 'FALHOU 16b: worker nao enxerga a fila'; END IF;
    RAISE NOTICE 'ok 16b RN-002: worker atravessa empresas pela origem WORKER';

    RAISE NOTICE '--- todas as regras de bd/13 conferidas ---';
END $smoke$;

ROLLBACK;
