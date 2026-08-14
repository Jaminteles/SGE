import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { ApprovalStatus, EntryStatus, EntryType, Prisma } from '@prisma/client';
import { FinancialEntriesService } from './financial-entries.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ReferencesService } from '../../common/references/references.service';
import { ApprovalThresholdsService } from '../approvals/approval-thresholds.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthenticatedUser } from '../../common/authorization/authenticated-user';
import { CreateFinancialEntryDto } from './dto/create-financial-entry.dto';

const CATEGORY = { type: EntryType.PAGAR, name: 'Fornecedores', acceptsEntry: true };

const APPROVER: AuthenticatedUser = {
  id: 'user-aprovador',
  email: 'aprovador@sge.local',
  isSuperAdmin: false,
};

function buildEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'titulo-1',
    number: 'CP-2026-000001',
    type: EntryType.PAGAR,
    status: EntryStatus.ABERTO,
    approvalStatus: ApprovalStatus.PENDENTE,
    netAmount: new Prisma.Decimal('900.00'),
    grossAmount: new Prisma.Decimal('1000.00'),
    discountAmount: new Prisma.Decimal('100.00'),
    settledAmount: new Prisma.Decimal('0'),
    createdById: 'user-lancador',
    issueDate: new Date('2026-08-01T00:00:00.000Z'),
    installments: [],
    ...overrides,
  };
}

function buildService(
  overrides: {
    entry?: Record<string, unknown>;
    category?: Record<string, unknown> | null;
    requiresApproval?: boolean;
  } = {},
) {
  const entryDelegate = {
    create: jest.fn().mockResolvedValue({ id: 'titulo-1' }),
    update: jest.fn().mockResolvedValue({}),
    findFirst: jest.fn().mockResolvedValue(overrides.entry ?? buildEntry()),
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
  };

  const prisma = {
    db: {
      financialEntry: entryDelegate,
      financialInstallment: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      category: {
        findFirst: jest
          .fn()
          .mockResolvedValue(overrides.category === undefined ? CATEGORY : overrides.category),
      },
      paymentTerm: { findFirst: jest.fn().mockResolvedValue(null) },
      $queryRaw: jest.fn().mockResolvedValue([{ numero: 'CP-2026-000001' }]),
    },
    transaction: jest.fn().mockImplementation((fn: () => unknown) => fn()),
  } as unknown as PrismaService;

  const references = {
    assert: jest.fn().mockResolvedValue(undefined),
  } as unknown as ReferencesService;

  const thresholds = {
    evaluate: jest
      .fn()
      .mockResolvedValue({ requiresApproval: overrides.requiresApproval ?? false }),
    assertAuthority: jest.fn().mockResolvedValue(undefined),
  } as unknown as ApprovalThresholdsService;

  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;

  return {
    service: new FinancialEntriesService(prisma, references, thresholds, audit),
    entryDelegate,
    thresholds,
    references,
  };
}

function entryDto(overrides: Partial<CreateFinancialEntryDto> = {}): CreateFinancialEntryDto {
  return {
    type: EntryType.PAGAR,
    description: 'Compra de material',
    partnerId: 'parceiro-1',
    grossAmount: '1000.00',
    ...overrides,
  } as CreateFinancialEntryDto;
}

describe('FinancialEntriesService', () => {
  describe('planEqualInstallments (RF-053)', () => {
    const rates = {
      dailyInterestRate: new Prisma.Decimal(0),
      penaltyRate: new Prisma.Decimal(0),
    };

    // O caso que erra em silêncio: 1000/3 dá 333,33 três vezes e um centavo
    // some. O banco recusaria no commit — aqui a sobra vai para a última.
    it('joga o resto da divisão na última parcela, sem perder centavo', () => {
      const { service } = buildService();

      const planned = service.planEqualInstallments(
        new Prisma.Decimal('1000.00'),
        3,
        new Date('2026-09-01T00:00:00.000Z'),
        30,
        rates,
      );

      expect(planned.map((p) => p.amount.toFixed(2))).toEqual(['333.33', '333.33', '333.34']);
      const sum = planned.reduce((total, p) => total.plus(p.amount), new Prisma.Decimal(0));
      expect(sum.toFixed(2)).toBe('1000.00');
    });

    it('espaça os vencimentos pelo intervalo informado', () => {
      const { service } = buildService();

      const planned = service.planEqualInstallments(
        new Prisma.Decimal('300.00'),
        3,
        new Date('2026-09-01T00:00:00.000Z'),
        15,
        rates,
      );

      expect(planned.map((p) => p.dueDate.toISOString().slice(0, 10))).toEqual([
        '2026-09-01',
        '2026-09-16',
        '2026-10-01',
      ]);
      expect(planned.every((p) => p.totalInstallments === 3)).toBe(true);
    });
  });

  it('recusa parcelas explícitas que não somam o valor líquido (RF-053)', async () => {
    const { service } = buildService();

    await expect(
      service.create(
        'empresa-1',
        entryDto({
          grossAmount: '900.00',
          installments: [
            { dueDate: '2026-09-01', amount: '400.00' },
            { dueDate: '2026-10-01', amount: '400.00' },
          ],
        }),
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // RF-054: categoria tem natureza. Classificar despesa como receita inverte o
  // sinal do resultado gerencial, e o erro só aparece no fechamento.
  it('recusa categoria de natureza diferente da do título', async () => {
    const { service } = buildService({ category: { ...CATEGORY, type: EntryType.RECEBER } });

    await expect(
      service.create('empresa-1', entryDto({ categoryId: 'categoria-1' }), 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recusa categoria sintética', async () => {
    const { service } = buildService({ category: { ...CATEGORY, acceptsEntry: false } });

    await expect(
      service.create('empresa-1', entryDto({ categoryId: 'categoria-1' }), 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('exige parceiro ou funcionário como contraparte', async () => {
    const { service } = buildService();

    await expect(
      service.create('empresa-1', entryDto({ partnerId: undefined }), 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recusa desconto maior que o valor bruto', async () => {
    const { service } = buildService();

    await expect(
      service.create('empresa-1', entryDto({ discountAmount: '1500.00' }), 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // RF-022/RF-023: título a pagar é emitido contra fornecedor; a receber, contra
  // cliente. O papel é conferido, não só a existência do parceiro.
  it('valida o papel do parceiro conforme a carteira', async () => {
    const { service, references } = buildService();

    await service.create('empresa-1', entryDto({ type: EntryType.RECEBER }), 'user-1');

    expect(references.assert).toHaveBeenCalledWith(
      'empresa-1',
      expect.objectContaining({ customerId: 'parceiro-1' }),
    );
  });

  // RF-056: acima da alçada o título nasce pendente — e o banco recusa baixá-lo
  // antes da decisão.
  it('nasce pendente de aprovação quando o valor cai numa alçada', async () => {
    const { service, entryDelegate } = buildService({ requiresApproval: true });

    await service.create('empresa-1', entryDto(), 'user-1');

    expect(entryDelegate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ approvalStatus: ApprovalStatus.PENDENTE }),
      }),
    );
  });

  it('nasce sem exigência de aprovação quando nenhuma alçada se aplica', async () => {
    const { service, entryDelegate } = buildService({ requiresApproval: false });

    await service.create('empresa-1', entryDto(), 'user-1');

    expect(entryDelegate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ approvalStatus: ApprovalStatus.NAO_REQUERIDA }),
      }),
    );
  });

  // RN-003: o título a pagar é onde uma despesa inventada vira dinheiro saindo.
  it('recusa que quem lançou o título o aprove', async () => {
    const { service } = buildService({ entry: buildEntry({ createdById: APPROVER.id }) });

    await expect(service.approve('empresa-1', 'titulo-1', {}, APPROVER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('consulta a alçada do aprovador pelo valor líquido do título', async () => {
    const { service, thresholds } = buildService();

    await service.approve('empresa-1', 'titulo-1', {}, APPROVER);

    expect(thresholds.assertAuthority).toHaveBeenCalledWith(
      'empresa-1',
      APPROVER,
      'TITULO_PAGAR',
      expect.objectContaining({ constructor: Prisma.Decimal }),
    );
  });

  it('recusa aprovar título que não está aguardando decisão', async () => {
    const { service } = buildService({
      entry: buildEntry({ approvalStatus: ApprovalStatus.APROVADO }),
    });

    await expect(service.approve('empresa-1', 'titulo-1', {}, APPROVER)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  // RF-057: reescrever o valor de um título já pago apagaria o contrato contra
  // o qual o pagamento foi feito.
  it('recusa alterar o valor de título com baixa', async () => {
    const { service } = buildService({
      entry: buildEntry({ settledAmount: new Prisma.Decimal('100.00') }),
    });

    await expect(
      service.update('empresa-1', 'titulo-1', { grossAmount: '500.00' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('recusa editar título cancelado', async () => {
    const { service } = buildService({ entry: buildEntry({ status: EntryStatus.CANCELADO }) });

    await expect(
      service.update('empresa-1', 'titulo-1', { description: 'nova' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('recusa cancelar título já liquidado', async () => {
    const { service } = buildService({ entry: buildEntry({ status: EntryStatus.LIQUIDADO }) });

    await expect(
      service.cancel('empresa-1', 'titulo-1', { reason: 'engano' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
