import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { IntegrationEventsService } from '../../common/integrations/integration-events.service';
import { JobQueueService } from '../../common/queue/job-queue.service';
import { IntegrationReprocessService } from './integration-reprocess.service';

function buildService(
  options: {
    job?: Record<string, unknown> | null;
    webhook?: Record<string, unknown> | null;
  } = {},
) {
  const prisma = {
    db: {
      jobExecution: {
        findFirst: jest.fn().mockResolvedValue(
          options.job === undefined
            ? {
                id: 'job-1',
                queue: 'pagamentos',
                name: 'pagamento.enviar',
                payload: { transactionId: 'tx-1' },
                status: 'FALHA',
                maxAttempts: 5,
              }
            : options.job,
        ),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      webhookEvent: {
        findFirst: jest.fn().mockResolvedValue(
          options.webhook === undefined
            ? {
                id: 'wh-1',
                status: 'FALHA',
                signatureValid: true,
                providerId: 'prov-1',
                eventType: 'payment.settled',
              }
            : options.webhook,
        ),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    },
  } as unknown as PrismaService;

  const queue = { enqueue: jest.fn().mockResolvedValue('job-2') } as unknown as JobQueueService;
  const events = {
    record: jest.fn().mockResolvedValue('evt-1'),
  } as unknown as IntegrationEventsService;
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;

  return {
    service: new IntegrationReprocessService(prisma, queue, events, audit),
    prisma,
    queue,
    events,
    audit,
  };
}

describe('IntegrationReprocessService.reprocess — job', () => {
  it('reenfileira o job falhado com chave de idempotência derivada do original', async () => {
    const { service, queue } = buildService();

    const result = await service.reprocess('empresa-1', { target: 'JOB', id: 'job-1' });

    expect(queue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        queue: 'pagamentos',
        name: 'pagamento.enviar',
        companyId: 'empresa-1',
        idempotencyKey: 'reprocesso:job:job-1',
      }),
    );
    expect(result).toMatchObject({ sourceId: 'job-1', jobId: 'job-2' });
  });

  it('recusa reprocessar job concluído: reexecutar pagamento pronto é duplicidade', async () => {
    const { service, queue } = buildService({
      job: {
        id: 'job-1',
        queue: 'pagamentos',
        name: 'x',
        payload: {},
        status: 'CONCLUIDO',
        maxAttempts: 5,
      },
    });

    await expect(
      service.reprocess('empresa-1', { target: 'JOB', id: 'job-1' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('não alcança job de outra empresa: a busca filtra por empresa junto com o id', async () => {
    const { service, prisma } = buildService({ job: null });

    await expect(
      service.reprocess('empresa-A', { target: 'JOB', id: 'job-da-empresa-B' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.db.jobExecution.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'job-da-empresa-B', companyId: 'empresa-A' } }),
    );
  });

  it('registra o reprocessamento no diário e na trilha de auditoria', async () => {
    const { service, events, audit } = buildService();

    await service.reprocess('empresa-1', { target: 'JOB', id: 'job-1', reason: 'provedor voltou' });

    expect(events.record).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'REPROCESSAMENTO', referenceType: 'job_execucao' }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 'job-1', companyId: 'empresa-1' }),
    );
  });
});

describe('IntegrationReprocessService.reprocess — webhook', () => {
  it('devolve o webhook falhado à fila de webhooks', async () => {
    const { service, queue } = buildService();

    await service.reprocess('empresa-1', { target: 'WEBHOOK', id: 'wh-1' });

    expect(queue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        queue: 'webhooks',
        payload: { eventId: 'wh-1' },
        idempotencyKey: 'reprocesso:webhook:wh-1',
      }),
    );
  });

  it('recusa webhook com assinatura inválida: o payload não se provou do provedor', async () => {
    const { service, queue } = buildService({
      webhook: { id: 'wh-1', status: 'FALHA', signatureValid: false, eventType: 'x' },
    });

    await expect(
      service.reprocess('empresa-1', { target: 'WEBHOOK', id: 'wh-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('recusa webhook que não está em falha', async () => {
    const { service } = buildService({
      webhook: { id: 'wh-1', status: 'CONCLUIDO', signatureValid: true, eventType: 'x' },
    });

    await expect(
      service.reprocess('empresa-1', { target: 'WEBHOOK', id: 'wh-1' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('IntegrationReprocessService.findFailed', () => {
  it('lista jobs em falha da empresa, sem payload de webhook', async () => {
    const { service, prisma } = buildService();

    await service.findFailed('empresa-1', { page: 1, pageSize: 20, skip: 0, take: 20 } as never);

    expect(prisma.db.jobExecution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: 'empresa-1' }),
      }),
    );
  });

  it('a lista de webhooks não projeta payload, assinatura nem headers', async () => {
    const { service, prisma } = buildService();

    await service.findFailed('empresa-1', {
      target: 'WEBHOOK',
      page: 1,
      pageSize: 20,
      skip: 0,
      take: 20,
    } as never);

    const select = (prisma.db.webhookEvent.findMany as jest.Mock).mock.calls[0][0].select;
    expect(select.payload).toBeUndefined();
    expect(select.signature).toBeUndefined();
    expect(select.headers).toBeUndefined();
  });
});
