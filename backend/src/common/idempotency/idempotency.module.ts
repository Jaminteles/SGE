import { Global, Module } from '@nestjs/common';
import { IdempotencyService } from './idempotency.service';

/**
 * Global: idempotência não é assunto de um módulo só (RF-067). Hoje é pagamento
 * e webhook (M09); importação de extrato e coleta fiscal usam o mesmo contrato.
 */
@Global()
@Module({
  providers: [IdempotencyService],
  exports: [IdempotencyService],
})
export class IdempotencyModule {}
