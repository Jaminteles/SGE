import { BadRequestException } from '@nestjs/common';
import { Prisma, PurchaseOrderStatus, StockMovementType } from '@prisma/client';
import { GoodsReceiptsService } from './goods-receipts.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ReferencesService } from '../../common/references/references.service';
import { StockMovementsService } from '../stock/stock-movements.service';
import { FinancialEntriesService } from '../finance/financial-entries.service';
import { PurchaseOrdersService } from './purchase-orders.service';

function orderItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    sequence: 1,
    productId: 'prod-1',
    product: { id: 'prod-1', code: 'CIM-01', description: 'Cimento', tracksStock: true },
    quantity: new Prisma.Decimal('10'),
    receivedQuantity: new Prisma.Decimal('0'),
    unitPrice: new Prisma.Decimal('5'),
    // 20,00 de frete rateados na linha: 2,00 por unidade.
    apportionedFreight: new Prisma.Decimal('20'),
    locationId: 'loc-1',
    ...overrides,
  };
}

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ped-1',
    companyId: 'empresa-1',
    number: 'PC-2026-000001',
    partnerId: 'forn-1',
    branchId: 'fil-1',
    categoryId: 'cat-1',
    costCenterId: null,
    paymentMethodId: null,
    paymentTermId: 'cond-1',
    status: PurchaseOrderStatus.APROVADO,
    items: [orderItem()],
    receipts: [],
    ...overrides,
  };
}

function buildService(current: Record<string, unknown> = order()) {
  const receiptDelegate = {
    create: jest
      .fn()
      .mockResolvedValue({ id: 'rec-1', receivedAt: new Date('2026-11-20T10:00:00Z') }),
    findFirst: jest.fn().mockResolvedValue({ id: 'rec-1', number: 'RC-2026-000001', items: [] }),
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
  };
  const receiptItemDelegate = {
    create: jest
      .fn()
      .mockImplementation(({ data }: { data: { accepted?: boolean } }) =>
        Promise.resolve({ id: 'rec-item-1', accepted: data.accepted ?? true }),
      ),
  };

  const prisma = {
    db: {
      goodsReceipt: receiptDelegate,
      goodsReceiptItem: receiptItemDelegate,
      $queryRaw: jest.fn().mockResolvedValue([{ numero: 'RC-2026-000001' }]),
    },
    transaction: jest.fn().mockImplementation((fn: () => unknown) => fn()),
  } as unknown as PrismaService;

  const references = {
    assert: jest.fn().mockResolvedValue(undefined),
  } as unknown as ReferencesService;

  const orders = {
    findReceivable: jest.fn().mockResolvedValue(current),
  } as unknown as PurchaseOrdersService;

  const movements = { record: jest.fn().mockResolvedValue([]) } as unknown as StockMovementsService;
  const entries = {
    createEntry: jest.fn().mockResolvedValue({ id: 'tit-1' }),
  } as unknown as FinancialEntriesService;

  return {
    service: new GoodsReceiptsService(prisma, references, orders, movements, entries),
    receiptItemDelegate,
    movements,
    entries,
  };
}

describe('GoodsReceiptsService', () => {
  // RF-039: receber mais do que foi pedido é o caminho silencioso para pagar
  // mercadoria que ninguém autorizou comprar.
  it('recusa recebimento acima do saldo pendente do item', async () => {
    const { service } = buildService();

    await expect(
      service.create(
        'empresa-1',
        'ped-1',
        {
          items: [{ orderItemId: 'item-1', receivedQuantity: '11' }],
        },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recusa conferir item que não é do pedido', async () => {
    const { service } = buildService();

    await expect(
      service.create(
        'empresa-1',
        'ped-1',
        {
          items: [{ orderItemId: 'item-intruso', receivedQuantity: '1' }],
        },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recusa o mesmo item duas vezes na mesma conferência', async () => {
    const { service } = buildService();

    await expect(
      service.create(
        'empresa-1',
        'ped-1',
        {
          items: [
            { orderItemId: 'item-1', receivedQuantity: '2' },
            { orderItemId: 'item-1', receivedQuantity: '3' },
          ],
        },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // RF-031: sem local, a mercadoria "chegou" sem estar em lugar nenhum.
  it('exige local de estoque para item que controla saldo', async () => {
    const { service } = buildService(order({ items: [orderItem({ locationId: null })] }));

    await expect(
      service.create(
        'empresa-1',
        'ped-1',
        {
          items: [{ orderItemId: 'item-1', receivedQuantity: '4' }],
        },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // RF-034/RF-037: frete que fica só no cabeçalho vira lucro aparente na
  // primeira saída — a entrada vale o custo posto.
  it('valoriza a entrada pelo preço do documento mais o frete rateado', async () => {
    const { service, movements } = buildService();

    await service.create(
      'empresa-1',
      'ped-1',
      {
        items: [{ orderItemId: 'item-1', receivedQuantity: '4', documentPrice: '6' }],
      },
      'user-1',
    );

    expect(movements.record).toHaveBeenCalledWith('empresa-1', [
      expect.objectContaining({
        productId: 'prod-1',
        locationId: 'loc-1',
        type: StockMovementType.ENTRADA,
        quantity: new Prisma.Decimal('4'),
        // 6,00 do documento + 2,00 de frete por unidade.
        unitCost: new Prisma.Decimal('8'),
        origin: 'RECEBIMENTO',
        originId: 'rec-item-1',
      }),
    ]);
  });

  // RF-040: linha recusada fica registrada — mas não entra no estoque nem abate
  // o pedido. É o que distingue "não chegou" de "chegou e foi devolvido".
  it('não movimenta estoque para linha recusada na conferência', async () => {
    const { service, movements } = buildService();

    await service.create(
      'empresa-1',
      'ped-1',
      {
        items: [{ orderItemId: 'item-1', receivedQuantity: '4', accepted: false }],
      },
      'user-1',
    );

    expect(movements.record).not.toHaveBeenCalled();
  });

  // RF-041: o título nasce do que chegou, pelo mesmo valor que entrou no
  // estoque, e ligado ao recebimento e ao pedido.
  it('gera o título a pagar do valor recebido, vinculado ao pedido', async () => {
    const { service, entries } = buildService();

    await service.create(
      'empresa-1',
      'ped-1',
      {
        generatePayable: true,
        items: [{ orderItemId: 'item-1', receivedQuantity: '4', documentPrice: '6' }],
      },
      'user-1',
    );

    expect(entries.createEntry).toHaveBeenCalledWith(
      'empresa-1',
      expect.objectContaining({
        type: 'PAGAR',
        partnerId: 'forn-1',
        grossAmount: '32.00',
        // A condição negociada no pedido é a do fornecedor.
        paymentTermId: 'cond-1',
      }),
      'user-1',
      { origin: 'RECEBIMENTO', originId: 'rec-1', purchaseOrderId: 'ped-1' },
    );
  });

  it('não gera título quando a entrega inteira foi recusada', async () => {
    const { service } = buildService();

    await expect(
      service.create(
        'empresa-1',
        'ped-1',
        {
          generatePayable: true,
          items: [{ orderItemId: 'item-1', receivedQuantity: '4', accepted: false }],
        },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('não gera título quando não foi pedido', async () => {
    const { service, entries } = buildService();

    await service.create(
      'empresa-1',
      'ped-1',
      {
        items: [{ orderItemId: 'item-1', receivedQuantity: '4' }],
      },
      'user-1',
    );

    expect(entries.createEntry).not.toHaveBeenCalled();
  });

  // O saldo pendente é medido contra o que já foi recebido, não contra o pedido
  // inteiro: a segunda entrega só pode trazer o que faltava.
  it('mede o pendente contra o que já foi recebido', async () => {
    const { service } = buildService(
      order({ items: [orderItem({ receivedQuantity: new Prisma.Decimal('7') })] }),
    );

    await expect(
      service.create(
        'empresa-1',
        'ped-1',
        {
          items: [{ orderItemId: 'item-1', receivedQuantity: '4' }],
        },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
