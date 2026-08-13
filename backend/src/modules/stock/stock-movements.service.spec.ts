import { BadRequestException } from '@nestjs/common';
import { Prisma, StockMovementType } from '@prisma/client';
import { StockMovementsService } from './stock-movements.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateStockMovementDto, StockEntryType } from './dto/create-stock-movement.dto';
import { CreateStockTransferDto } from './dto/create-stock-transfer.dto';

const PRODUCT = {
  id: 'prod-1',
  code: 'SKU-001',
  tracksStock: true,
  isActive: true,
  averageCost: new Prisma.Decimal('7.5'),
};

const LOCATION = { id: 'loc-1', code: 'DEP-01', isActive: true };

function buildService(
  overrides: {
    product?: Record<string, unknown> | null;
    location?: Record<string, unknown> | null;
    balance?: { averageCost: Prisma.Decimal } | null;
  } = {},
) {
  const movementDelegate = {
    create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'mov-1', ...data })),
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
  };

  const prisma = {
    db: {
      product: {
        findFirst: jest
          .fn()
          .mockResolvedValue(overrides.product === undefined ? PRODUCT : overrides.product),
      },
      stockLocation: {
        findFirst: jest
          .fn()
          .mockResolvedValue(overrides.location === undefined ? LOCATION : overrides.location),
      },
      stockBalance: {
        findFirst: jest.fn().mockResolvedValue(overrides.balance ?? null),
      },
      stockMovement: movementDelegate,
    },
    transaction: jest.fn().mockImplementation((fn: () => unknown) => fn()),
  } as unknown as PrismaService;

  return { service: new StockMovementsService(prisma), movementDelegate, prisma };
}

function movementDto(overrides: Partial<CreateStockMovementDto> = {}): CreateStockMovementDto {
  return {
    type: StockEntryType.ENTRADA,
    productId: 'prod-1',
    locationId: 'loc-1',
    quantity: '10',
    unitCost: '5',
    ...overrides,
  } as CreateStockMovementDto;
}

function transferDto(overrides: Partial<CreateStockTransferDto> = {}): CreateStockTransferDto {
  return {
    productId: 'prod-1',
    fromLocationId: 'loc-1',
    toLocationId: 'loc-2',
    quantity: '4',
    ...overrides,
  } as CreateStockTransferDto;
}

describe('StockMovementsService', () => {
  // RF-031: serviço e item sem controle não têm saldo — o banco recusa, e aqui
  // a recusa vira 400 em vez de 500.
  it('recusa movimentar item que não controla estoque', async () => {
    const { service } = buildService({ product: { ...PRODUCT, tracksStock: false } });

    await expect(service.create('empresa-1', movementDto(), 'user-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('recusa movimentar item inativo', async () => {
    const { service } = buildService({ product: { ...PRODUCT, isActive: false } });

    await expect(service.create('empresa-1', movementDto(), 'user-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('recusa local inativo', async () => {
    const { service } = buildService({ location: { ...LOCATION, isActive: false } });

    await expect(service.create('empresa-1', movementDto(), 'user-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  // RN-001: id de outra empresa não existe para esta requisição.
  it('recusa produto de outra empresa', async () => {
    const { service } = buildService({ product: null });

    await expect(service.create('empresa-1', movementDto(), 'user-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('recusa quantidade zero ou negativa', async () => {
    const { service } = buildService();

    await expect(
      service.create('empresa-1', movementDto({ quantity: '0' }), 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // RF-034: entrada sem custo puxaria a média ponderada para zero, e o que
  // saísse depois apareceria como lucro integral.
  it('exige custo unitário na entrada', async () => {
    const { service } = buildService();

    await expect(
      service.create('empresa-1', movementDto({ unitCost: undefined }), 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recusa entrada com custo zero', async () => {
    const { service } = buildService();

    await expect(
      service.create('empresa-1', movementDto({ unitCost: '0' }), 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // RF-032: ajuste é correção sem fato comercial que a explique.
  it('exige justificativa no ajuste', async () => {
    const { service } = buildService();

    await expect(
      service.create(
        'empresa-1',
        movementDto({ type: StockEntryType.AJUSTE_POSITIVO, unitCost: undefined }),
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('valoriza o ajuste positivo pelo custo médio do local', async () => {
    const { service, movementDelegate } = buildService({
      balance: { averageCost: new Prisma.Decimal('3.25') },
    });

    await service.create(
      'empresa-1',
      movementDto({
        type: StockEntryType.AJUSTE_POSITIVO,
        unitCost: undefined,
        note: 'Sobra encontrada na prateleira',
      }),
      'user-1',
    );

    expect(movementDelegate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ unitCost: new Prisma.Decimal('3.25') }),
      }),
    );
  });

  // Local ainda sem saldo formado: o custo do item na empresa é a melhor
  // aproximação, e é o mesmo número que a valorização usa.
  it('usa o custo médio do item quando o local ainda não tem saldo', async () => {
    const { service, movementDelegate } = buildService({ balance: null });

    await service.create(
      'empresa-1',
      movementDto({
        type: StockEntryType.AJUSTE_POSITIVO,
        unitCost: undefined,
        note: 'Sobra encontrada na prateleira',
      }),
      'user-1',
    );

    expect(movementDelegate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ unitCost: PRODUCT.averageCost }),
      }),
    );
  });

  it('recusa transferência para o mesmo local', async () => {
    const { service } = buildService();

    await expect(
      service.transfer('empresa-1', transferDto({ toLocationId: 'loc-1' }), 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // RF-032: a transferência é uma operação só. Meia transferência faria a
  // mercadoria sumir sem ter saído da empresa.
  it('grava as duas pernas da transferência na mesma transação', async () => {
    const { service, movementDelegate, prisma } = buildService({
      balance: { averageCost: new Prisma.Decimal('9') },
    });

    const result = await service.transfer('empresa-1', transferDto(), 'user-1');

    expect(prisma.transaction).toHaveBeenCalledTimes(1);
    expect(movementDelegate.create).toHaveBeenCalledTimes(2);

    const [saida, entrada] = movementDelegate.create.mock.calls.map(
      ([args]: [{ data: Record<string, unknown> }]) => args.data,
    );
    expect(saida).toMatchObject({
      type: StockMovementType.TRANSFERENCIA_SAIDA,
      locationId: 'loc-1',
      counterpartId: 'loc-2',
    });
    expect(entrada).toMatchObject({
      type: StockMovementType.TRANSFERENCIA_ENTRADA,
      locationId: 'loc-2',
      counterpartId: 'loc-1',
    });
    // A mercadoria viaja com o custo da origem: uma operação interna não cria
    // nem destrói valor.
    expect(saida.unitCost).toEqual(new Prisma.Decimal('9'));
    expect(entrada.unitCost).toEqual(new Prisma.Decimal('9'));
    // Chave comum: sem ela, a transferência só é reconstituível por coincidência.
    expect(saida.originId).toBe(result.transferId);
    expect(entrada.originId).toBe(result.transferId);
  });

  // RN-001: o recorte por empresa é do servidor.
  it('filtra pela empresa ativa na consulta do razão', async () => {
    const { service, movementDelegate } = buildService();

    await service.findAll('empresa-1', { page: 1, pageSize: 20, skip: 0, take: 20 } as never);

    expect(movementDelegate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: 'empresa-1' }) }),
    );
  });

  // Período semiaberto: com `lte`, um movimento das 23:59:59.7 do último dia
  // ficaria de fora do relatório do mês.
  it('trata o fim do período como exclusivo', async () => {
    const { service, movementDelegate } = buildService();

    await service.findAll('empresa-1', {
      page: 1,
      pageSize: 20,
      skip: 0,
      take: 20,
      from: '2026-10-01T00:00:00Z',
      to: '2026-11-01T00:00:00Z',
    } as never);

    const { where } = movementDelegate.findMany.mock.calls[0][0];
    expect(where.movementDate).toEqual({
      gte: new Date('2026-10-01T00:00:00Z'),
      lt: new Date('2026-11-01T00:00:00Z'),
    });
  });
});
