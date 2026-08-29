import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationMonitorService } from './integration-monitor.service';

function buildService(healthRows: Record<string, unknown>[] = []) {
  const queryRaw = jest
    .fn()
    // 1ª chamada: a view de saúde. 2ª e 3ª: os resumos de fila e webhook.
    .mockResolvedValueOnce(healthRows)
    .mockResolvedValueOnce([
      { status: 'FALHA', total: 3n },
      { status: 'PENDENTE', total: 2n },
    ])
    .mockResolvedValueOnce([{ status: 'CONCLUIDO', total: 7n }]);

  const prisma = {
    db: {
      $queryRaw: queryRaw,
      integrationEvent: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    },
  } as unknown as PrismaService;

  return { service: new IntegrationMonitorService(prisma), prisma, queryRaw };
}

const row = {
  integracao_id: 'int-1',
  codigo: 'BANCO',
  nome: 'Banco',
  status: 'ATIVA',
  ativo: true,
  provedor_codigo: 'SANDBOX',
  provedor_categoria: 'BANCARIO',
  falhas_consecutivas: 2,
  limite_falhas: 10,
  ultima_execucao_em: null,
  ultimo_sucesso_em: null,
  ultimo_erro_em: null,
  ultimo_erro: null,
  eventos_24h: 40n,
  erros_24h: 2n,
  ultimo_evento_erro_em: null,
};

describe('IntegrationMonitorService.health', () => {
  it('marca como degradada a integração ativa que já acumulou falha', async () => {
    const { service } = buildService([row]);

    const result = await service.health('empresa-1');

    expect(result.integrations[0].degraded).toBe(true);
    expect(result.totals).toMatchObject({ total: 1, active: 1, suspended: 0, degraded: 1 });
  });

  it('converte os bigint das contagens: JSON não serializa bigint', async () => {
    const { service } = buildService([row]);

    const result = await service.health('empresa-1');

    expect(result.integrations[0].events24h).toBe(40);
    expect(result.queue.failed).toBe(3);
    expect(result.queue.pending).toBe(2);
    expect(() => JSON.stringify(result)).not.toThrow();
  });
});

describe('IntegrationMonitorService.findEvents', () => {
  it('filtra o diário pela empresa ativa, e não só pelo id pedido', async () => {
    const { service, prisma } = buildService();

    await service.findEvents('empresa-A', {
      integrationId: 'int-da-empresa-B',
      page: 1,
      pageSize: 20,
      skip: 0,
      take: 20,
    } as never);

    expect(prisma.db.integrationEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: 'empresa-A',
          integrationId: 'int-da-empresa-B',
        }),
      }),
    );
  });
});
