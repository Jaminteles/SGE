import { Module } from '@nestjs/common';

import { CashFlowController } from './cash-flow.controller';
import { CashFlowService } from './cash-flow.service';
import { ScenariosController } from './scenarios.controller';
import { ScenariosService } from './scenarios.service';
import { CashAlertsController } from './cash-alerts.controller';
import { CashAlertsService } from './cash-alerts.service';

/**
 * M14 — Fluxo de Caixa e Planejamento (RF-101 a RF-105): consolidação de
 * entradas e saídas, projeção por período, separação entre realizado, previsto
 * e vencido, cenários com premissas e alerta de insuficiência de caixa.
 *
 * O módulo não grava movimento nenhum: o fluxo é leitura de `vw_fluxo_caixa`
 * (bd/10), que projeta títulos e baixas do M08. Só o planejamento — cenário,
 * projeção digitada e configuração de alerta — tem tabela própria.
 *
 * Nada é exportado: quem quiser fluxo de caixa consulta a API. Um módulo de
 * leitura exportado vira dependência de escrita na sprint seguinte.
 */
@Module({
  controllers: [CashFlowController, ScenariosController, CashAlertsController],
  providers: [CashFlowService, ScenariosService, CashAlertsService],
})
export class CashFlowModule {}
