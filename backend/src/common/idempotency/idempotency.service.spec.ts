import { ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { IDEMPOTENCY_SCOPE, IdempotencyService } from './idempotency.service';

interface Existing {
  requestHash: string | null;
  response: unknown;
}

function buildService(existing: Existing | null) {
  const created: Record<string, unknown>[] = [];
  const updated: Record<string, unknown>[] = [];

  const prisma = {
    db: {
      idempotencyRecord: {
        findFirst: jest.fn().mockResolvedValue(existing),
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return Promise.resolve({ id: 'idem-1' });
        }),
        updateMany: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          updated.push(data);
          return Promise.resolve({ count: 1 });
        }),
      },
    },
  } as unknown as PrismaService;

  return { service: new IdempotencyService(prisma), created, updated };
}

const REQUEST = { amount: '100.00', bankAccountId: 'conta-1' };

describe('IdempotencyService', () => {
  it('executa e grava o resultado na primeira chamada', async () => {
    const { service, created, updated } = buildService(null);
    const execute = jest.fn().mockResolvedValue({
      resourceId: 'tx-1',
      resourceType: 'transacao_pagamento',
      response: { id: 'tx-1' },
    });

    const run = await service.run({
      companyId: 'empresa-1',
      scope: IDEMPOTENCY_SCOPE.PAYMENT,
      key: 'pagamento-fornecedor-42',
      request: REQUEST,
      execute,
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(run.replayed).toBe(false);
    expect(run.response).toEqual({ id: 'tx-1' });
    expect(created[0]).toMatchObject({ scope: 'PAGAMENTO', key: 'pagamento-fornecedor-42' });
    expect(updated[0]).toMatchObject({ resourceId: 'tx-1' });
  });

  it('repete a resposta sem executar de novo — o retry não paga duas vezes', async () => {
    const hashOfRequest = requestHash(REQUEST);
    const { service } = buildService({ requestHash: hashOfRequest, response: { id: 'tx-1' } });
    const execute = jest.fn();

    const run = await service.run({
      companyId: 'empresa-1',
      scope: IDEMPOTENCY_SCOPE.PAYMENT,
      key: 'pagamento-fornecedor-42',
      request: REQUEST,
      execute,
    });

    expect(execute).not.toHaveBeenCalled();
    expect(run.replayed).toBe(true);
    expect(run.response).toEqual({ id: 'tx-1' });
  });

  it('recusa a mesma chave com outro conteúdo', async () => {
    const { service } = buildService({ requestHash: 'hash-de-outro-corpo', response: { id: 'x' } });
    const execute = jest.fn();

    await expect(
      service.run({
        companyId: 'empresa-1',
        scope: IDEMPOTENCY_SCOPE.PAYMENT,
        key: 'pagamento-fornecedor-42',
        request: { amount: '10000.00' },
        execute,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(execute).not.toHaveBeenCalled();
  });

  it('recusa quando a reserva existe mas ainda não tem resultado', async () => {
    const { service } = buildService({ requestHash: requestHash(REQUEST), response: null });

    await expect(
      service.run({
        companyId: 'empresa-1',
        scope: IDEMPOTENCY_SCOPE.PAYMENT,
        key: 'pagamento-fornecedor-42',
        request: REQUEST,
        execute: jest.fn(),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

/** Mesmo cálculo do serviço: SHA-256 do corpo serializado. */
function requestHash(request: unknown): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  return createHash('sha256').update(JSON.stringify(request)).digest('hex');
}
