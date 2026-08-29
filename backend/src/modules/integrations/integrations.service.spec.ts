import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationEventsService } from '../../common/integrations/integration-events.service';
import { IntegrationsService } from './integrations.service';
import { CreateIntegrationDto } from './dto/integration.dto';

interface BuildOptions {
  integration?: Record<string, unknown> | null;
  credential?: Record<string, unknown> | null;
  provider?: Record<string, unknown> | null;
  duplicate?: Record<string, unknown> | null;
}

function buildService(options: BuildOptions = {}) {
  const created: Record<string, unknown>[] = [];
  const integrationFindFirst = jest
    .fn()
    .mockResolvedValue(
      options.integration === undefined
        ? { id: 'int-1', code: 'BANCO', provider: { id: 'prov-1' }, credential: { id: 'cred-1' } }
        : options.integration,
    );

  const prisma = {
    db: {
      integration: {
        findFirst: jest.fn().mockImplementation((args: { where: Record<string, unknown> }) =>
          // A checagem de duplicidade consulta por `code`; o resto é findOne.
          'code' in args.where
            ? Promise.resolve(options.duplicate ?? null)
            : integrationFindFirst(args),
        ),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return Promise.resolve({ id: 'int-1', code: data.code, ...data });
        }),
        update: jest.fn().mockResolvedValue({ id: 'int-1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      provider: {
        findFirst: jest
          .fn()
          .mockResolvedValue(options.provider === undefined ? { id: 'prov-1' } : options.provider),
      },
      integrationCredential: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            options.credential === undefined ? { id: 'cred-1' } : options.credential,
          ),
      },
    },
  } as unknown as PrismaService;

  const events = {
    record: jest.fn().mockResolvedValue('evt-1'),
  } as unknown as IntegrationEventsService;

  return { service: new IntegrationsService(prisma, events), prisma, events, created };
}

const dto: CreateIntegrationDto = {
  providerId: 'prov-1',
  credentialId: 'cred-1',
  code: 'BANCO-PIX',
  name: 'PIX do banco',
};

describe('IntegrationsService.create', () => {
  it('nasce INATIVA: integração recém-cadastrada não chama o provedor sozinha', async () => {
    const { service, created } = buildService();

    await service.create('empresa-1', dto);

    expect(created[0]).toMatchObject({ companyId: 'empresa-1', status: 'INATIVA' });
  });

  it('recusa parâmetro com nome de credencial: segredo não mora em jsonb legível', async () => {
    const { service } = buildService();

    await expect(
      service.create('empresa-1', { ...dto, parameters: { baseUrl: 'x', apiKey: 'segredo' } }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recusa credencial que não é da empresa e do provedor da integração', async () => {
    const { service } = buildService({ credential: null });

    await expect(service.create('empresa-1', dto)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recusa código repetido na mesma empresa', async () => {
    const { service } = buildService({ duplicate: { id: 'outra' } });

    await expect(service.create('empresa-1', dto)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('IntegrationsService — isolamento entre empresas', () => {
  it('não encontra integração de outra empresa mesmo com o id certo na rota', async () => {
    const { service, prisma } = buildService({ integration: null });

    await expect(service.findOne('empresa-A', 'id-da-empresa-B')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.db.integration.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'id-da-empresa-B', companyId: 'empresa-A' } }),
    );
  });

  it('a transição de situação filtra por empresa, não só por id', async () => {
    const { service, prisma } = buildService();

    await service.deactivate('empresa-A', 'int-1');

    expect(prisma.db.integration.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'int-1', companyId: 'empresa-A' } }),
    );
  });
});

describe('IntegrationsService — situação da integração', () => {
  it('recusa ativar integração sem credencial vinculada', async () => {
    const { service } = buildService({
      integration: { id: 'int-1', code: 'BANCO', provider: { id: 'prov-1' }, credential: null },
    });

    await expect(service.activate('empresa-1', 'int-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('recusa ativar integração suspensa: retomar é decisão explícita', async () => {
    const { service } = buildService({
      integration: {
        id: 'int-1',
        code: 'BANCO',
        status: 'SUSPENSA',
        provider: { id: 'prov-1' },
        credential: { id: 'cred-1' },
      },
    });

    await expect(service.activate('empresa-1', 'int-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('retomar zera a contagem de falhas para a próxima falha não reabrir a suspensão', async () => {
    const { service, prisma } = buildService({
      integration: {
        id: 'int-1',
        code: 'BANCO',
        status: 'SUSPENSA',
        suspensionReason: 'provedor fora',
        provider: { id: 'prov-1' },
        credential: { id: 'cred-1' },
      },
    });

    await service.resume('empresa-1', 'int-1');

    expect(prisma.db.integration.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'ATIVA', failureStreak: 0 }),
      }),
    );
  });

  it('recusa retomar o que não está suspenso', async () => {
    const { service } = buildService({
      integration: {
        id: 'int-1',
        code: 'BANCO',
        status: 'ATIVA',
        provider: { id: 'prov-1' },
        credential: { id: 'cred-1' },
      },
    });

    await expect(service.resume('empresa-1', 'int-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('registra no diário toda mudança de configuração', async () => {
    const { service, events } = buildService();

    await service.setParameters('empresa-1', 'int-1', { parameters: { baseUrl: 'https://x' } });

    expect(events.record).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'CONFIGURACAO', operation: 'integracao.parametros' }),
    );
  });
});
