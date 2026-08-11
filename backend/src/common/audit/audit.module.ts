import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';

/**
 * Registro da trilha de auditoria (M16).
 *
 * Global porque todo módulo de negócio das próximas sprints precisa emitir
 * eventos (aprovação, pagamento, recebimento, cancelamento) sem que cada um
 * tenha de importar o módulo. A consulta da trilha fica em `modules/audit`.
 */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
