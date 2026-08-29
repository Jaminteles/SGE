import { Module } from '@nestjs/common';

import { ApiDocsService } from './api-docs.service';
import { IntegrationMonitorService } from './integration-monitor.service';
import { IntegrationReprocessService } from './integration-reprocess.service';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';

/**
 * M18 — Administração e Integrações (RF-126 a RF-131).
 *
 * Administra as integrações externas da empresa (RF-126), seus parâmetros e a
 * credencial que as autentica (RF-127), monitora sua saúde e a da fila
 * (RF-128), guarda o diário de eventos e erros (RF-129), reprocessa o que
 * falhou (RF-130) e publica a documentação da API por rota autenticada
 * (RF-131).
 *
 * Não importa o M09: a única coisa que vem de lá é a constante com o nome do
 * job de webhook. O M18 devolve trabalho às filas dos módulos donos, nunca
 * reimplementa o efeito — e para enfileirar basta o nome, não o serviço.
 *
 * O registro de eventos vem do módulo global `IntegrationEventsModule`; a
 * auditoria, do `AuditModule`; a fila, do `QueueModule`.
 */
@Module({
  controllers: [IntegrationsController],
  providers: [
    IntegrationsService,
    IntegrationMonitorService,
    IntegrationReprocessService,
    ApiDocsService,
  ],
  exports: [ApiDocsService],
})
export class IntegrationsModule {}
