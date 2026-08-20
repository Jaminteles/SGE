import { Module } from '@nestjs/common';

import { CompanyAccountsController } from './company-accounts.controller';
import { CompanyAccountsService } from './company-accounts.service';
import { CredentialsController } from './credentials.controller';
import { CredentialsService } from './credentials.service';
import { PaymentsController } from './payments.controller';
import { PaymentTransactionsService } from './payment-transactions.service';
import { PaymentSettlementsService } from './payment-settlements.service';
import { StatementsController } from './statements.controller';
import { StatementsService } from './statements.service';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { WebhookProcessorService } from './webhook-processor.service';
import { PaymentJobsService } from './jobs/payment-jobs.service';
import { ProviderResolver } from './providers/provider-resolver.service';
import { ManualPaymentProvider } from './providers/manual.provider';
import { HttpBankProvider } from './providers/http-bank.provider';

/**
 * M09 — Bancos, Pagamentos e Recebimentos (RF-059 a RF-070) e a importação de
 * extrato de M10 (RF-060): contas bancárias da empresa, provedores financeiros
 * atrás de uma porta única, ordens PIX/boleto/TED com agendamento, envio e
 * consulta por fila com retry controlado, cancelamento onde o provedor suporta,
 * webhooks idempotentes e identificador externo registrado.
 *
 * Não importa `FinanceModule`: a baixa gerada por ordem confirmada é escrita
 * por `PaymentSettlementsService`, que fala com `titulo_baixa` diretamente. A
 * razão é a regra de RN-004 — a baixa originada de transação tem uma condição
 * que a baixa manual não tem (transação confirmada, mesma parcela, mesma conta,
 * uma por transação), aplicada por índice único e trigger em bd/13 §6. Passar
 * por `SettlementsService` obrigaria aquele serviço a conhecer transações
 * bancárias para nada — as validações dele (saldo, encargos negociados, alçada)
 * são de quem digita uma baixa, não de quem recebe a confirmação do banco.
 *
 * A fila e a idempotência vêm dos módulos globais `QueueModule` e
 * `IdempotencyModule`; a cifra das credenciais, de `CryptoModule`.
 */
@Module({
  controllers: [
    CompanyAccountsController,
    CredentialsController,
    PaymentsController,
    StatementsController,
    WebhooksController,
  ],
  providers: [
    CompanyAccountsService,
    CredentialsService,
    PaymentTransactionsService,
    PaymentSettlementsService,
    StatementsService,
    WebhooksService,
    WebhookProcessorService,
    PaymentJobsService,
    ProviderResolver,
    ManualPaymentProvider,
    HttpBankProvider,
  ],
  exports: [CompanyAccountsService, PaymentTransactionsService],
})
export class BankingModule {}
