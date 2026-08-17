import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { ApprovalStatus, Prisma, PurchaseOrderStatus } from '@prisma/client';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ReferencesService } from '../../common/references/references.service';
import { AuditService } from '../../common/audit/audit.service';
import { ApprovalThresholdsService } from '../approvals/approval-thresholds.service';
import { AuthenticatedUser } from '../../common/authorization/authenticated-user';

const APPROVER: AuthenticatedUser = {
  id: 'user-aprovador',
  email: 'aprovador@sge.local',
  isSuperAdmin: false,
};

function orderItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    sequence: 1,
    productId: 'prod-1',
    quantity: new Prisma.Decimal('10'),
    receivedQuantity: new Prisma.Decimal('0'),
    unitPrice: new Prisma.Decimal('5'),
    lineAmount: new Prisma.Decimal('50'),
    ...overrides,
  };
}

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ped-1',
    companyId: 'empresa-1',
    number: 'PC-2026-000001',
    partnerId: 'forn-1',
    requesterId: 'user-comprador',
    createdById: 'user-comprador',
    status: PurchaseOrderStatus.RASCUNHO,
    approvalStatus: ApprovalStatus.NAO_REQUERIDA,
    totalAmount: new Prisma.Decimal('50'),
    items: [orderItem()],
    receipts: [],
    ...overrides,
  };
}

function buildService(current: Record<string, unknown> | null = order(), requiresApproval = true) {
  const orderDelegate = {
    findFirst: jest.fn().mockResolvedValue(current),
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn().mockResolvedValue({ id: 'ped-1' }),
    update: jest.fn().mockResolvedValue(current),
  };
  const itemDelegate = {
    deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    createMany: jest.fn().mockResolvedValue({ count: 1 }),
  };

  const categoryDelegate = {
    findFirst: jest.fn().mockResolvedValue({
      type: 'PAGAR',
      name: 'Materiais',
      acceptsEntry: true,
    }),
  };

  const prisma = {
    db: {
      purchaseOrder: orderDelegate,
      purchaseOrderItem: itemDelegate,
      product: { findFirst: jest.fn().mockResolvedValue({ description: 'Cimento CP-II' }) },
      category: categoryDelegate,
      $queryRaw: jest.fn().mockResolvedValue([{ numero: 'PC-2026-000001' }]),
    },
    transaction: jest.fn().mockImplementation((fn: () => unknown) => fn()),
  } as unknown as PrismaService;

  const references = {
    assert: jest.fn().mockResolvedValue(undefined),
  } as unknown as ReferencesService;

  const thresholds = {
    evaluate: jest.fn().mockResolvedValue({ requiresApproval, authorizedRoles: [] }),
    assertAuthority: jest.fn().mockResolvedValue(undefined),
  } as unknown as ApprovalThresholdsService;

  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;

  return {
    service: new PurchaseOrdersService(prisma, references, thresholds, audit),
    orderDelegate,
    itemDelegate,
    categoryDelegate,
    thresholds,
    audit,
  };
}

const baseDto = {
  partnerId: 'forn-1',
  items: [{ productId: 'prod-1', quantity: '10', unitPrice: '5' }],
};

describe('PurchaseOrdersService', () => {
  // RF-037: preço zero num pedido zera o custo médio da entrada e transforma o
  // que sair depois em lucro aparente.
  it('recusa item com preço unitário zerado', async () => {
    const { service } = buildService();

    await expect(
      service.create(
        'empresa-1',
        {
          ...baseDto,
          items: [{ productId: 'prod-1', quantity: '10', unitPrice: '0' }],
        },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recusa desconto de item maior que a linha', async () => {
    const { service } = buildService();

    await expect(
      service.create(
        'empresa-1',
        {
          ...baseDto,
          items: [{ productId: 'prod-1', quantity: '2', unitPrice: '10', discountAmount: '25.00' }],
        },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('exige descrição no item sem produto do catálogo', async () => {
    const { service } = buildService();

    await expect(
      service.create(
        'empresa-1',
        { ...baseDto, items: [{ quantity: '1', unitPrice: '10' }] },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // RF-041/RF-054: categoria de receita numa compra inverte o sinal do
  // resultado gerencial, e o erro só aparece no fechamento.
  it('recusa categoria financeira de natureza RECEBER', async () => {
    const { service, categoryDelegate } = buildService();
    categoryDelegate.findFirst.mockResolvedValueOnce({
      type: 'RECEBER',
      name: 'Vendas',
      acceptsEntry: true,
    });

    await expect(
      service.create('empresa-1', { ...baseDto, categoryId: 'cat-1' }, 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // RF-038: aprovar um pedido cujos itens ainda podem mudar não é aprovar nada.
  it('recusa editar pedido fora do rascunho', async () => {
    const { service } = buildService(order({ status: PurchaseOrderStatus.APROVADO }));

    await expect(service.update('empresa-1', 'ped-1', { note: 'ajuste' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('substitui a lista inteira de itens na edição do rascunho', async () => {
    const { service, itemDelegate } = buildService();

    await service.update('empresa-1', 'ped-1', {
      items: [{ productId: 'prod-1', quantity: '3', unitPrice: '7' }],
    });

    expect(itemDelegate.deleteMany).toHaveBeenCalledWith({ where: { orderId: 'ped-1' } });
    const removidos = itemDelegate.deleteMany.mock.invocationCallOrder[0];
    const criados = itemDelegate.createMany.mock.invocationCallOrder[0];
    expect(removidos).toBeLessThan(criados);
  });

  // Acima da alçada, o pedido espera decisão — e o banco recusa recebimento até lá.
  it('envia à aprovação quando o valor exige alçada', async () => {
    const { service, orderDelegate } = buildService(order(), true);

    await service.submitForApproval('empresa-1', 'ped-1');

    expect(orderDelegate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          status: PurchaseOrderStatus.AGUARDANDO_APROVACAO,
          approvalStatus: ApprovalStatus.PENDENTE,
        },
      }),
    );
  });

  // Abaixo da alçada, exigir a cerimônia de aprovação para toda compra
  // transformaria o controle em carimbo.
  it('aprova direto quando o valor está abaixo da alçada', async () => {
    const { service, orderDelegate } = buildService(order(), false);

    await service.submitForApproval('empresa-1', 'ped-1');

    expect(orderDelegate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          status: PurchaseOrderStatus.APROVADO,
          approvalStatus: ApprovalStatus.NAO_REQUERIDA,
        },
      }),
    );
  });

  it('recusa submeter pedido sem itens', async () => {
    const { service } = buildService(order({ items: [] }));

    await expect(service.submitForApproval('empresa-1', 'ped-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  // RN-003: é no pedido que uma compra desnecessária vira dinheiro comprometido.
  it('recusa que o solicitante aprove o próprio pedido', async () => {
    const { service } = buildService(
      order({
        status: PurchaseOrderStatus.AGUARDANDO_APROVACAO,
        approvalStatus: ApprovalStatus.PENDENTE,
        requesterId: APPROVER.id,
      }),
    );

    await expect(service.approve('empresa-1', 'ped-1', {}, APPROVER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('exige alçada compatível com o valor do pedido', async () => {
    const { service, thresholds } = buildService(
      order({
        status: PurchaseOrderStatus.AGUARDANDO_APROVACAO,
        approvalStatus: ApprovalStatus.PENDENTE,
      }),
    );

    await service.approve('empresa-1', 'ped-1', {}, APPROVER);

    expect(thresholds.assertAuthority).toHaveBeenCalledWith(
      'empresa-1',
      APPROVER,
      'PEDIDO_COMPRA',
      new Prisma.Decimal('50'),
    );
  });

  it('recusa aprovar pedido que não está aguardando decisão', async () => {
    const { service } = buildService(order({ approvalStatus: ApprovalStatus.APROVADO }));

    await expect(service.approve('empresa-1', 'ped-1', {}, APPROVER)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  // RF-114: aprovação e reprovação são decisões, não DML própria.
  it('registra a decisão na trilha de auditoria', async () => {
    const { service, audit } = buildService(
      order({
        status: PurchaseOrderStatus.AGUARDANDO_APROVACAO,
        approvalStatus: ApprovalStatus.PENDENTE,
      }),
    );

    await service.reject('empresa-1', 'ped-1', { reason: 'Preço acima do mercado' }, APPROVER);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'REPROVACAO',
        entity: 'pedido_compra',
        note: expect.stringContaining('Preço acima do mercado'),
      }),
    );
  });

  // RN-009: o que chegou está no estoque e precisa continuar tendo um pedido que
  // o explique.
  it('recusa cancelar pedido com entrega registrada', async () => {
    const { service } = buildService(
      order({
        status: PurchaseOrderStatus.PARCIALMENTE_RECEBIDO,
        receipts: [{ id: 'rec-1', number: 'RC-2026-000001' }],
      }),
    );

    await expect(
      service.cancel('empresa-1', 'ped-1', { reason: 'Fornecedor atrasou' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('recusa recebimento em pedido que não foi aprovado', async () => {
    const { service } = buildService(order({ status: PurchaseOrderStatus.AGUARDANDO_APROVACAO }));

    await expect(service.findReceivable('empresa-1', 'ped-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
