import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AuditEvent, EntryType, InstallmentStatus, Prisma } from '@prisma/client';
import { SettlementsService } from './settlements.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InstallmentsService } from './installments.service';
import { ReferencesService } from '../../common/references/references.service';
import { AuditService } from '../../common/audit/audit.service';
import { CreateSettlementDto } from './dto/create-settlement.dto';

const SETTLEMENT = {
  id: 'baixa-1',
  principalAmount: new Prisma.Decimal('150.00'),
  interestAmount: new Prisma.Decimal('1.32'),
  penaltyAmount: new Prisma.Decimal('8.00'),
  discountAmount: new Prisma.Decimal('0'),
  totalAmount: new Prisma.Decimal('159.32'),
  paymentMethodId: null,
  method: null,
  isReversed: false,
  reversalOfId: null,
};

function buildInstallment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'parcela-1',
    number: 1,
    totalInstallments: 2,
    status: InstallmentStatus.ABERTA,
    balance: new Prisma.Decimal('400.00'),
    dailyInterestRate: new Prisma.Decimal('0.033'),
    penaltyRate: new Prisma.Decimal('2'),
    entry: { id: 'titulo-1', number: 'CP-2026-000001', type: EntryType.PAGAR, status: 'ABERTO' },
    settlements: [SETTLEMENT],
    ...overrides,
  };
}

function buildService(
  overrides: { installment?: Record<string, unknown>; position?: Record<string, unknown> } = {},
) {
  const installmentRow = overrides.installment ?? buildInstallment();

  const settlementDelegate = {
    create: jest.fn().mockResolvedValue({ id: 'baixa-nova' }),
  };

  const prisma = {
    db: {
      settlement: settlementDelegate,
      financialInstallment: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(installmentRow),
      },
      $queryRaw: jest
        .fn()
        .mockResolvedValue(overrides.position ? [overrides.position] : [{ dias_atraso: 0 }]),
    },
    transaction: jest.fn().mockImplementation((fn: () => unknown) => fn()),
  } as unknown as PrismaService;

  const installments = {
    findOne: jest.fn().mockResolvedValue(installmentRow),
  } as unknown as InstallmentsService;

  const references = {
    assert: jest.fn().mockResolvedValue(undefined),
  } as unknown as ReferencesService;

  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;

  return {
    service: new SettlementsService(prisma, installments, references, audit),
    settlementDelegate,
    audit,
  };
}

function settlementDto(overrides: Partial<CreateSettlementDto> = {}): CreateSettlementDto {
  return { principalAmount: '100.00', ...overrides } as CreateSettlementDto;
}

describe('SettlementsService', () => {
  // RF-057: o teto é o principal em aberto. O banco também recusa — aqui vira
  // 400 com o número, em vez de 500 de violação de regra.
  it('recusa baixa de principal acima do saldo da parcela', async () => {
    const { service } = buildService();

    await expect(
      service.create(
        'empresa-1',
        'titulo-1',
        'parcela-1',
        settlementDto({ principalAmount: '400.01' }),
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('aceita a baixa que zera exatamente o saldo', async () => {
    const { service, settlementDelegate } = buildService();

    await service.create(
      'empresa-1',
      'titulo-1',
      'parcela-1',
      settlementDto({ principalAmount: '400.00' }),
      'user-1',
    );

    expect(settlementDelegate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          principalAmount: expect.objectContaining({ constructor: Prisma.Decimal }),
        }),
      }),
    );
  });

  it('recusa principal zerado ou negativo', async () => {
    const { service } = buildService();

    await expect(
      service.create(
        'empresa-1',
        'titulo-1',
        'parcela-1',
        settlementDto({ principalAmount: '0' }),
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recusa baixa em parcela já liquidada', async () => {
    const { service } = buildService({
      installment: buildInstallment({
        status: InstallmentStatus.LIQUIDADA,
        balance: new Prisma.Decimal('0'),
      }),
    });

    await expect(
      service.create('empresa-1', 'titulo-1', 'parcela-1', settlementDto(), 'user-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('recusa desconto maior que o valor da baixa', async () => {
    const { service } = buildService();

    await expect(
      service.create(
        'empresa-1',
        'titulo-1',
        'parcela-1',
        settlementDto({ principalAmount: '100.00', discountAmount: '150.00' }),
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // RF-114: caixa é o que mais importa auditar, e pagamento/recebimento não têm
  // DML própria que os distinga de uma inserção qualquer.
  it('registra pagamento na trilha quando o título é a pagar', async () => {
    const { service, audit } = buildService();

    await service.create('empresa-1', 'titulo-1', 'parcela-1', settlementDto(), 'user-1');

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ event: AuditEvent.PAGAMENTO }),
    );
  });

  it('registra recebimento na trilha quando o título é a receber', async () => {
    const { service, audit } = buildService({
      installment: buildInstallment({
        entry: {
          id: 'titulo-1',
          number: 'CR-2026-000001',
          type: EntryType.RECEBER,
          status: 'ABERTO',
        },
      }),
    });

    await service.create('empresa-1', 'titulo-1', 'parcela-1', settlementDto(), 'user-1');

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ event: AuditEvent.RECEBIMENTO }),
    );
  });

  // RF-055: com `applyLateCharges`, o valor cobrado é o mesmo que a carteira
  // mostra — multa e juros separados por natureza, para o relatório fiscal.
  it('calcula juros e multa do atraso a partir da posição da carteira', async () => {
    const { service, settlementDelegate } = buildService({
      position: {
        dias_atraso: 10,
        encargos: new Prisma.Decimal('9.32'),
        saldo: new Prisma.Decimal('400.00'),
      },
    });

    await service.create(
      'empresa-1',
      'titulo-1',
      'parcela-1',
      settlementDto({ principalAmount: '400.00', applyLateCharges: true }),
      'user-1',
    );

    const { data } = settlementDelegate.create.mock.calls[0][0];
    expect(data.penaltyAmount.toFixed(2)).toBe('8.00');
    expect(data.interestAmount.toFixed(2)).toBe('1.32');
  });

  it('não cobra encargo em parcela dentro do prazo', async () => {
    const { service, settlementDelegate } = buildService({ position: { dias_atraso: 0 } });

    await service.create(
      'empresa-1',
      'titulo-1',
      'parcela-1',
      settlementDto({ applyLateCharges: true }),
      'user-1',
    );

    const { data } = settlementDelegate.create.mock.calls[0][0];
    expect(data.interestAmount.toFixed(2)).toBe('0.00');
    expect(data.penaltyAmount.toFixed(2)).toBe('0.00');
  });

  it('prefere os encargos informados aos calculados', async () => {
    const { service, settlementDelegate } = buildService({
      position: {
        dias_atraso: 10,
        encargos: new Prisma.Decimal('9.32'),
        saldo: new Prisma.Decimal('400.00'),
      },
    });

    await service.create(
      'empresa-1',
      'titulo-1',
      'parcela-1',
      settlementDto({ applyLateCharges: true, interestAmount: '1.00', penaltyAmount: '2.00' }),
      'user-1',
    );

    const { data } = settlementDelegate.create.mock.calls[0][0];
    expect(data.interestAmount.toFixed(2)).toBe('1.00');
    expect(data.penaltyAmount.toFixed(2)).toBe('2.00');
  });

  describe('estorno (RF-057)', () => {
    it('lança o espelho apontando para a baixa original, sem apagar nada', async () => {
      const { service, settlementDelegate } = buildService();

      await service.reverse(
        'empresa-1',
        'titulo-1',
        'parcela-1',
        'baixa-1',
        { reason: 'Pagamento em duplicidade' },
        'user-1',
      );

      const { data } = settlementDelegate.create.mock.calls[0][0];
      expect(data.reversalOfId).toBe('baixa-1');
      expect(data.principalAmount).toEqual(SETTLEMENT.principalAmount);
      expect(data.reversalReason).toBe('Pagamento em duplicidade');
    });

    it('recusa estornar duas vezes a mesma baixa', async () => {
      const { service } = buildService({
        installment: buildInstallment({ settlements: [{ ...SETTLEMENT, isReversed: true }] }),
      });

      await expect(
        service.reverse(
          'empresa-1',
          'titulo-1',
          'parcela-1',
          'baixa-1',
          { reason: 'de novo' },
          'user-1',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('recusa estornar um lançamento de estorno', async () => {
      const { service } = buildService({
        installment: buildInstallment({
          settlements: [{ ...SETTLEMENT, reversalOfId: 'baixa-0' }],
        }),
      });

      await expect(
        service.reverse('empresa-1', 'titulo-1', 'parcela-1', 'baixa-1', { reason: 'x' }, 'user-1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('responde 404 para baixa de outra parcela', async () => {
      const { service } = buildService({ installment: buildInstallment({ settlements: [] }) });

      await expect(
        service.reverse('empresa-1', 'titulo-1', 'parcela-1', 'baixa-9', { reason: 'x' }, 'user-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
