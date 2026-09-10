import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AuditEvent, EntryType, InstallmentStatus, Prisma } from '@prisma/client';
import { SettlementsService } from './settlements.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InstallmentsService } from './installments.service';
import { ReferencesService } from '../../common/references/references.service';
import { AuditService } from '../../common/audit/audit.service';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { CreateSettlementDto } from './dto/create-settlement.dto';

const KEY = 'chave-baixa-0001';

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

  // Como na primeira chamada de uma chave: executa e devolve o resultado.
  const outcomes: unknown[] = [];
  const idempotency = {
    run: jest
      .fn()
      .mockImplementation(async (params: { execute: () => Promise<{ response: unknown }> }) => {
        const outcome = await params.execute();
        outcomes.push(outcome);
        return { replayed: false, response: outcome.response };
      }),
  };

  return {
    service: new SettlementsService(
      prisma,
      installments,
      references,
      audit,
      idempotency as unknown as IdempotencyService,
    ),
    settlementDelegate,
    audit,
    installments,
    idempotency,
    outcomes,
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
        KEY,
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
      KEY,
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
        KEY,
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
      service.create('empresa-1', 'titulo-1', 'parcela-1', settlementDto(), 'user-1', KEY),
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
        KEY,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // RF-114: caixa é o que mais importa auditar, e pagamento/recebimento não têm
  // DML própria que os distinga de uma inserção qualquer.
  it('registra pagamento na trilha quando o título é a pagar', async () => {
    const { service, audit } = buildService();

    await service.create('empresa-1', 'titulo-1', 'parcela-1', settlementDto(), 'user-1', KEY);

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

    await service.create('empresa-1', 'titulo-1', 'parcela-1', settlementDto(), 'user-1', KEY);

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
      KEY,
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
      KEY,
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
      KEY,
    );

    const { data } = settlementDelegate.create.mock.calls[0][0];
    expect(data.interestAmount.toFixed(2)).toBe('1.00');
    expect(data.penaltyAmount.toFixed(2)).toBe('2.00');
  });

  // RN-004: retry, timeout ou clique duplo não podem gerar segunda baixa.
  it('amarra a chave à parcela e ao corpo, e grava a baixa criada', async () => {
    const { service, idempotency, outcomes } = buildService();
    const dto = settlementDto({ principalAmount: '400.00' });

    await service.create('empresa-1', 'titulo-1', 'parcela-1', dto, 'user-1', KEY);

    expect(idempotency.run).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'empresa-1',
        scope: 'PAGAMENTO',
        key: KEY,
        userId: 'user-1',
        request: { entryId: 'titulo-1', installmentId: 'parcela-1', settlement: dto },
      }),
    );
    expect(outcomes[0]).toEqual(
      expect.objectContaining({ resourceId: 'baixa-nova', resourceType: 'titulo_baixa' }),
    );
  });

  it('devolve a baixa já registrada no retry, sem validar nem lançar de novo', async () => {
    // A parcela já foi quitada pela primeira tentativa: validar antes da chave
    // responderia 409 a um retry legítimo.
    const { service, idempotency, settlementDelegate, installments, audit } = buildService({
      installment: buildInstallment({
        status: InstallmentStatus.LIQUIDADA,
        balance: new Prisma.Decimal('0'),
      }),
    });
    const anterior = { id: 'parcela-1', status: 'LIQUIDADA' };
    idempotency.run.mockResolvedValueOnce({ replayed: true, response: anterior });

    await expect(
      service.create(
        'empresa-1',
        'titulo-1',
        'parcela-1',
        settlementDto({ principalAmount: '400.00' }),
        'user-1',
        KEY,
      ),
    ).resolves.toBe(anterior);
    expect(settlementDelegate.create).not.toHaveBeenCalled();
    expect(installments.findOne).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
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
