import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma, StockMovementType } from '@prisma/client';
import { InventoriesService } from './inventories.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ReferencesService } from '../../common/references/references.service';
import { AuditService } from '../../common/audit/audit.service';
import { StockMovementsService } from './stock-movements.service';
import { AuthenticatedUser } from '../../common/authorization/authenticated-user';
import { InventoryStatus } from '../../common/enums';

const APPROVER: AuthenticatedUser = {
  id: 'user-aprovador',
  email: 'aprovador@sge.local',
  isSuperAdmin: false,
};

function item(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'item-1',
    productId: 'prod-1',
    systemQuantity: new Prisma.Decimal('10'),
    countedQuantity: new Prisma.Decimal('8'),
    difference: new Prisma.Decimal('-2'),
    unitCost: new Prisma.Decimal('4'),
    ...overrides,
  };
}

function inventory(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'inv-1',
    companyId: 'empresa-1',
    locationId: 'loc-1',
    number: 'INV-2026-000001',
    status: InventoryStatus.EM_CONTAGEM,
    responsibleId: 'user-contador',
    items: [item()],
    ...overrides,
  };
}

function buildService(current: Record<string, unknown> | null = inventory()) {
  const inventoryDelegate = {
    findFirst: jest.fn().mockResolvedValue(current),
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn().mockResolvedValue({ id: 'inv-1' }),
    update: jest.fn().mockResolvedValue(current),
  };
  const itemDelegate = {
    update: jest.fn().mockResolvedValue(item()),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  };

  const prisma = {
    db: {
      inventory: inventoryDelegate,
      inventoryItem: itemDelegate,
      stockBalance: { findMany: jest.fn().mockResolvedValue([]) },
      product: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([{ numero: 'INV-2026-000001' }]),
    },
    transaction: jest.fn().mockImplementation((fn: () => unknown) => fn()),
  } as unknown as PrismaService;

  const references = {
    assert: jest.fn().mockResolvedValue(undefined),
    assertUserBelongsToCompany: jest.fn().mockResolvedValue(undefined),
  } as unknown as ReferencesService;

  const movements = { record: jest.fn().mockResolvedValue([]) } as unknown as StockMovementsService;
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;

  return {
    service: new InventoriesService(prisma, references, movements, audit),
    inventoryDelegate,
    itemDelegate,
    movements,
    audit,
  };
}

describe('InventoriesService', () => {
  // RF-033: contagem concluída é terminal — recontar é abrir outro inventário.
  it('recusa concluir um inventário já concluído', async () => {
    const { service } = buildService(inventory({ status: InventoryStatus.CONCLUIDO }));

    await expect(service.close('empresa-1', 'inv-1', APPROVER)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('recusa lançar contagem antes de liberar a contagem', async () => {
    const { service } = buildService(inventory({ status: InventoryStatus.ABERTO }));

    await expect(
      service.count('empresa-1', 'inv-1', {
        counts: [{ productId: 'prod-1', countedQuantity: '8' }],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('recusa contagem de produto fora do inventário', async () => {
    const { service } = buildService();

    await expect(
      service.count('empresa-1', 'inv-1', {
        counts: [{ productId: 'prod-intruso', countedQuantity: '8' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // RN-003: o ajuste escreve perda ou sobra direto no ativo — quem contou não
  // homologa a própria diferença.
  it('recusa que o responsável pela contagem a conclua', async () => {
    const { service } = buildService(inventory({ responsibleId: APPROVER.id }));

    await expect(service.close('empresa-1', 'inv-1', APPROVER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('recusa concluir com item ainda não contado', async () => {
    const { service } = buildService(
      inventory({ items: [item(), item({ id: 'item-2', countedQuantity: null })] }),
    );

    await expect(service.close('empresa-1', 'inv-1', APPROVER)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  // RF-033/RF-032: a diferença apurada não é escrita no saldo — vira lançamento
  // no razão, com origem INVENTARIO.
  it('lança ajuste negativo para a falta apurada', async () => {
    const { service, movements } = buildService();

    await service.close('empresa-1', 'inv-1', APPROVER);

    expect(movements.record).toHaveBeenCalledWith('empresa-1', [
      expect.objectContaining({
        productId: 'prod-1',
        locationId: 'loc-1',
        type: StockMovementType.AJUSTE_NEGATIVO,
        quantity: new Prisma.Decimal('2'),
        origin: 'INVENTARIO',
        originId: 'inv-1',
      }),
    ]);
  });

  it('lança ajuste positivo para a sobra apurada', async () => {
    const { service, movements } = buildService(
      inventory({
        items: [
          item({ countedQuantity: new Prisma.Decimal('13'), difference: new Prisma.Decimal('3') }),
        ],
      }),
    );

    await service.close('empresa-1', 'inv-1', APPROVER);

    expect(movements.record).toHaveBeenCalledWith('empresa-1', [
      expect.objectContaining({
        type: StockMovementType.AJUSTE_POSITIVO,
        quantity: new Prisma.Decimal('3'),
      }),
    ]);
  });

  it('não lança movimento quando a contagem bate com o sistema', async () => {
    const { service, movements, inventoryDelegate } = buildService(
      inventory({
        items: [
          item({ countedQuantity: new Prisma.Decimal('10'), difference: new Prisma.Decimal('0') }),
        ],
      }),
    );

    await service.close('empresa-1', 'inv-1', APPROVER);

    expect(movements.record).not.toHaveBeenCalled();
    expect(inventoryDelegate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: InventoryStatus.CONCLUIDO }),
      }),
    );
  });

  // O trigger de bd/08 recusa escrita em item de inventário concluído: marcar
  // depois de mudar a situação falharia.
  it('marca os itens ajustados antes de concluir', async () => {
    const { service, itemDelegate, inventoryDelegate } = buildService();

    await service.close('empresa-1', 'inv-1', APPROVER);

    const marcados = itemDelegate.updateMany.mock.invocationCallOrder[0];
    const concluido = inventoryDelegate.update.mock.invocationCallOrder[0];
    expect(marcados).toBeLessThan(concluido);
  });

  // RF-114: conclusão e cancelamento são decisões, não DML própria — vão à trilha.
  it('registra o fechamento na trilha de auditoria', async () => {
    const { service, audit } = buildService();

    await service.close('empresa-1', 'inv-1', APPROVER);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'FECHAMENTO', entity: 'inventario', entityId: 'inv-1' }),
    );
  });

  it('registra o motivo do cancelamento na trilha', async () => {
    const { service, audit } = buildService();

    await service.cancel('empresa-1', 'inv-1', { reason: 'Contagem interrompida pela auditoria' });

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'CANCELAMENTO',
        note: expect.stringContaining('Contagem interrompida pela auditoria'),
      }),
    );
  });

  // Dois inventários simultâneos no mesmo local ajustariam duas vezes a mesma
  // sobra — o segundo fechamento "corrige" o que o primeiro já corrigiu.
  it('recusa abrir uma segunda contagem no mesmo local', async () => {
    const { service } = buildService(inventory({ status: InventoryStatus.ABERTO }));

    await expect(
      service.create('empresa-1', { locationId: 'loc-1' }, 'user-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
