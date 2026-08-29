import { Global, Module } from '@nestjs/common';
import { IntegrationEventsService } from './integration-events.service';

/**
 * Diário das integrações (M18 — RF-129).
 *
 * Global pela mesma razão do `AuditModule`: quem fala com o mundo externo está
 * espalhado por M09, M10, M11, M12, M13 e M14, e nenhum desses módulos deveria
 * precisar importar o módulo de administração para conseguir registrar que uma
 * chamada falhou. A consulta e o reprocessamento ficam em `modules/integrations`.
 */
@Global()
@Module({
  providers: [IntegrationEventsService],
  exports: [IntegrationEventsService],
})
export class IntegrationEventsModule {}
