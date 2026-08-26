import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { NotificationChannel, NotificationStatus } from '@prisma/client';
import { JobQueueService } from '../../common/queue/job-queue.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

interface CreatedRow {
  userId: string | null;
  channel: NotificationChannel;
  status: NotificationStatus;
  dedupeKey?: string;
  recipientEmail?: string;
  sentAt?: Date;
}

function buildService(options: { existing?: Record<string, unknown> | null } = {}) {
  const created: CreatedRow[] = [];
  const updates: Record<string, unknown>[] = [];

  const prisma = {
    db: {
      notification: {
        createMany: jest.fn(({ data }: { data: CreatedRow[] }) => {
          created.push(...data);
          return Promise.resolve({ count: data.length });
        }),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(options.existing ?? null),
        findFirstOrThrow: jest.fn().mockResolvedValue({ id: 'aviso-1' }),
        count: jest.fn().mockResolvedValue(0),
        updateMany: jest.fn((args: { where: Record<string, unknown> }) => {
          updates.push(args.where);
          return Promise.resolve({ count: 1 });
        }),
      },
      membership: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
    },
  } as unknown as PrismaService;

  const queue = { enqueue: jest.fn().mockResolvedValue('job-1') } as unknown as JobQueueService;

  return { service: new NotificationsService(prisma, queue), created, updates, prisma, queue };
}

const input = {
  type: 'VENCIMENTO',
  title: 'Parcela a vencer',
  message: 'Parcela 1/3 vence amanhã.',
  entity: 'titulo_parcela',
  entityId: '11111111-1111-1111-1111-111111111111',
  dedupeKey: 'VENCIMENTO:parcela-1:2026-08-27',
};

describe('NotificationsService.emit', () => {
  it('entrega o aviso interno já como ENVIADA: gravar é entregar', async () => {
    const { service, created } = buildService();

    await service.emit('empresa-1', input, [{ userId: 'user-1', email: 'a@b.com' }]);

    expect(created).toHaveLength(1);
    expect(created[0].status).toBe(NotificationStatus.ENVIADA);
    expect(created[0].sentAt).toBeInstanceOf(Date);
  });

  it('separa a chave de dedupe por destinatário: avisar um não cala os demais', async () => {
    const { service, created } = buildService();

    await service.emit('empresa-1', input, [
      { userId: 'user-1', email: 'a@b.com' },
      { userId: 'user-2', email: 'c@d.com' },
    ]);

    expect(created.map((row) => row.dedupeKey)).toEqual([
      'VENCIMENTO:parcela-1:2026-08-27:user-1:INTERNO',
      'VENCIMENTO:parcela-1:2026-08-27:user-2:INTERNO',
    ]);
  });

  it('descarta o canal de e-mail sem endereço sem perder o aviso interno', async () => {
    const { service, created } = buildService();

    await service.emit(
      'empresa-1',
      input,
      [{ userId: 'user-1', email: null }],
      [NotificationChannel.INTERNO, NotificationChannel.EMAIL],
    );

    expect(created).toHaveLength(1);
    expect(created[0].channel).toBe(NotificationChannel.INTERNO);
  });

  it('enfileira o despacho do que precisa sair da aplicação', async () => {
    const { service, queue, prisma } = buildService();
    (prisma.db.notification.findMany as jest.Mock).mockResolvedValue([{ id: 'aviso-1' }]);

    await service.emit(
      'empresa-1',
      input,
      [{ userId: 'user-1', email: 'a@b.com' }],
      [NotificationChannel.EMAIL],
    );

    expect(queue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'empresa-1',
        idempotencyKey: 'notificacoes.enviar:aviso-1',
      }),
    );
  });

  it('não grava nada quando não há destinatário', async () => {
    const { service, created, queue } = buildService();

    const count = await service.emit('empresa-1', input, []);

    expect(count).toBe(0);
    expect(created).toHaveLength(0);
    expect(queue.enqueue).not.toHaveBeenCalled();
  });
});

describe('NotificationsService.markRead', () => {
  it('não alcança a notificação de outra empresa trocando o id da rota', async () => {
    const { service } = buildService({ existing: null });

    await expect(service.markRead('empresa-1', 'user-1', 'aviso-de-outra')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('recusa marcar como lido o aviso pessoal de outra pessoa da mesma empresa', async () => {
    const { service } = buildService({
      existing: { id: 'aviso-1', userId: 'user-2', status: NotificationStatus.ENVIADA },
    });

    await expect(service.markRead('empresa-1', 'user-1', 'aviso-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('condiciona a transição ao estado esperado: duas abas não brigam', async () => {
    const { service, updates } = buildService({
      existing: { id: 'aviso-1', userId: 'user-1', status: NotificationStatus.ENVIADA },
    });

    await service.markRead('empresa-1', 'user-1', 'aviso-1');

    expect(updates[0]).toMatchObject({
      id: 'aviso-1',
      companyId: 'empresa-1',
      userId: 'user-1',
      status: NotificationStatus.ENVIADA,
    });
  });
});

describe('NotificationsService.findAll', () => {
  it('mostra o que é do usuário e o que é da empresa, nunca o de terceiros', async () => {
    const { service, prisma } = buildService();

    await service.findAll('empresa-1', 'user-1', {
      page: 1,
      pageSize: 20,
      skip: 0,
      take: 20,
    } as never);

    const where = (prisma.db.notification.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.companyId).toBe('empresa-1');
    expect(where.OR).toEqual([{ userId: 'user-1' }, { userId: null }]);
  });
});
