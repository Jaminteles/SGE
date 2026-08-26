import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { NotificationChannel, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AutomationRulesService } from './automation-rules.service';
import { CreateAutomationRuleDto } from './dto/automation-rule.dto';

function buildService(memberships: { userId: string }[] = []) {
  const created: Record<string, unknown>[] = [];

  const prisma = {
    db: {
      automationRule: {
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return Promise.resolve({ id: 'regra-1', triggerEvent: data.triggerEvent, ...data });
        }),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({ id: 'regra-1' }),
        count: jest.fn().mockResolvedValue(0),
      },
      automationRuleRun: { create: jest.fn().mockResolvedValue({ id: 'exec-1' }) },
      membership: { findMany: jest.fn().mockResolvedValue(memberships) },
    },
  } as unknown as PrismaService;

  return { service: new AutomationRulesService(prisma), created, prisma };
}

const rule: CreateAutomationRuleDto = {
  name: 'Vencimentos do financeiro',
  triggerEvent: 'TITULO_VENCENDO',
  conditions: { daysAhead: 5 },
  actions: [
    {
      type: 'NOTIFICAR',
      channel: NotificationChannel.INTERNO,
      permission: 'financial-entries:READ',
    },
  ],
};

describe('AutomationRulesService.create', () => {
  it('grava condições e ações como jsonb, presas à empresa ativa', async () => {
    const { service, created } = buildService();

    await service.create('empresa-1', rule);

    expect(created[0]).toMatchObject({ companyId: 'empresa-1', triggerEvent: 'TITULO_VENCENDO' });
    expect(created[0].isActive).toBe(true);
  });

  it('recusa ação sem destinatário: a regra casaria e não avisaria ninguém', async () => {
    const { service } = buildService();

    await expect(
      service.create('empresa-1', {
        ...rule,
        actions: [{ type: 'NOTIFICAR', channel: NotificationChannel.INTERNO }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recusa permissão fora do catálogo: ela nunca resolveria destinatário', async () => {
    const { service } = buildService();

    await expect(
      service.create('empresa-1', {
        ...rule,
        actions: [
          {
            type: 'NOTIFICAR',
            channel: NotificationChannel.INTERNO,
            permission: 'financeiro:LER',
          },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recusa destinatário que não é da empresa ativa', async () => {
    const { service } = buildService([]);

    await expect(
      service.create('empresa-1', {
        ...rule,
        actions: [
          {
            type: 'NOTIFICAR',
            channel: NotificationChannel.INTERNO,
            userIds: ['22222222-2222-2222-2222-222222222222'],
          },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('aceita destinatário nomeado que pertence à empresa', async () => {
    const { service, created } = buildService([{ userId: '22222222-2222-2222-2222-222222222222' }]);

    await service.create('empresa-1', {
      ...rule,
      actions: [
        {
          type: 'NOTIFICAR',
          channel: NotificationChannel.INTERNO,
          userIds: ['22222222-2222-2222-2222-222222222222'],
        },
      ],
    });

    expect(created).toHaveLength(1);
  });

  it('traduz o nome repetido em conflito, não em 500', async () => {
    const { service, prisma } = buildService();
    (prisma.db.automationRule.create as jest.Mock).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicada', {
        code: 'P2002',
        clientVersion: '6',
      }),
    );

    await expect(service.create('empresa-1', rule)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('AutomationRulesService.findOne', () => {
  it('devolve 404 para regra de outra empresa: id na rota não atravessa tenant', async () => {
    const { service } = buildService();

    await expect(service.findOne('empresa-1', 'regra-de-outra')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
