import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { JobRegistry } from './job-registry.service';
import { JobWorkerService } from './job-worker.service';
import { PermanentJobError, QUEUES } from './job.types';

interface ClaimedRow {
  id: string;
  empresa_id: string | null;
  fila: string;
  nome: string;
  payload: Record<string, unknown>;
  tentativas: number;
  max_tentativas: number;
  correlation_id: string | null;
}

function claimed(overrides: Partial<ClaimedRow> = {}): ClaimedRow {
  return {
    id: 'job-1',
    empresa_id: 'empresa-1',
    fila: QUEUES.PAYMENTS,
    nome: 'payment.send',
    payload: { transactionId: 'tx-1' },
    tentativas: 1,
    max_tentativas: 3,
    correlation_id: null,
    ...overrides,
  };
}

function buildWorker(rows: (ClaimedRow | null)[], handler?: jest.Mock) {
  const updates: { where: { id: string }; data: Record<string, unknown> }[] = [];
  const contexts: Record<string, unknown>[] = [];
  const queue = [...rows];

  const prisma = {
    runAsSystem: jest.fn((context: Record<string, unknown>, fn: () => Promise<unknown>) => {
      contexts.push(context);
      return fn();
    }),
    db: {
      $queryRaw: jest.fn(() =>
        Promise.resolve(queue.length > 0 ? [queue.shift()].filter(Boolean) : []),
      ),
      jobExecution: {
        update: jest.fn((args: { where: { id: string }; data: Record<string, unknown> }) => {
          updates.push(args);
          return Promise.resolve({});
        }),
      },
    },
  } as unknown as PrismaService;

  const registry = new JobRegistry();
  if (handler) {
    registry.register({ name: 'payment.send', queue: QUEUES.PAYMENTS, handle: handler });
  }

  const config = {
    get: (key: string) =>
      ({
        WORKER_ENABLED: false,
        WORKER_POLL_INTERVAL_MS: 1_000,
        WORKER_BATCH_SIZE: 2,
        JOB_BACKOFF_BASE_MS: 1_000,
        JOB_BACKOFF_MAX_MS: 10_000,
      })[key],
  } as unknown as ConfigService;

  return { worker: new JobWorkerService(prisma, registry, config), updates, contexts };
}

describe('JobWorkerService', () => {
  it('conclui o job no mesmo commit do efeito', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    const { worker, updates } = buildWorker([claimed(), null], handler);

    const processed = await worker.runOnce();

    expect(processed).toBe(1);
    expect(handler).toHaveBeenCalledWith(
      { transactionId: 'tx-1' },
      expect.objectContaining({ attempt: 1 }),
    );
    expect(updates[0].data).toMatchObject({ status: 'CONCLUIDO' });
  });

  it('roda o handler com a empresa do job no contexto de banco (RN-001)', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    const { worker, contexts } = buildWorker([claimed(), null], handler);

    await worker.runOnce();

    expect(contexts).toContainEqual(
      expect.objectContaining({ origin: 'WORKER', companyId: 'empresa-1' }),
    );
  });

  it('reagenda com backoff quando ainda há tentativa (RF-070)', async () => {
    const handler = jest.fn().mockRejectedValue(new Error('provedor fora do ar'));
    const { worker, updates } = buildWorker([claimed({ tentativas: 1 }), null], handler);

    await worker.runOnce();

    expect(updates[0].data).toMatchObject({ status: 'AGENDADO' });
    expect(updates[0].data.scheduledFor).toBeInstanceOf(Date);
    expect((updates[0].data.scheduledFor as Date).getTime()).toBeGreaterThan(Date.now());
  });

  it('encerra em FALHA quando as tentativas se esgotam', async () => {
    const handler = jest.fn().mockRejectedValue(new Error('provedor fora do ar'));
    const { worker, updates } = buildWorker(
      [claimed({ tentativas: 3, max_tentativas: 3 }), null],
      handler,
    );

    await worker.runOnce();

    expect(updates[0].data).toMatchObject({ status: 'FALHA', error: 'provedor fora do ar' });
  });

  it('encerra em FALHA na hora quando o erro é permanente — não gasta tentativas', async () => {
    const handler = jest.fn().mockRejectedValue(new PermanentJobError('payload sem transactionId'));
    const { worker, updates } = buildWorker([claimed({ tentativas: 1 }), null], handler);

    await worker.runOnce();

    expect(updates[0].data).toMatchObject({ status: 'FALHA' });
  });

  it('devolve à fila sem queimar a tentativa quando o handler não existe neste processo', async () => {
    const { worker, updates } = buildWorker([claimed(), null]);

    await worker.runOnce();

    expect(updates[0].data).toMatchObject({ status: 'AGENDADO', maxAttempts: 4 });
  });

  it('para a rodada quando a fila está vazia', async () => {
    const { worker } = buildWorker([null], jest.fn());

    expect(await worker.runOnce()).toBe(0);
  });
});
