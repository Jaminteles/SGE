import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditQueryService } from './audit-query.service';

/** Consulta da trilha de auditoria (M16, RF-117). A escrita fica em common/audit. */
@Module({
  controllers: [AuditController],
  providers: [AuditQueryService],
})
export class AuditQueryModule {}
