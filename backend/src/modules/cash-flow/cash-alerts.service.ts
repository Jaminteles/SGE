import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { formatDateOnly, toDateOnly } from '../../common/utils/date-only';
import { CashFlowService } from './cash-flow.service';
import { CreateCashAlertDto } from './dto/create-cash-alert.dto';
import { UpdateCashAlertDto } from './dto/update-cash-alert.dto';

const alertSelect = {
  id: true,
  name: true,
  bankAccountId: true,
  minimumBalance: true,
  daysAhead: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CashAlertSelect;

const ZERO = new Prisma.Decimal(0);
const DAY_MS = 86_400_000;

/**
 * Alerta de insuficiência de caixa (RF-105).
 *
 * A configuração é gravada; o disparo, não. Avaliar é caminhar o saldo dia a
 * dia dentro do horizonte e responder onde ele cruza o mínimo — e essa resposta
 * muda a cada baixa registrada, o que faz de qualquer "alerta disparado" salvo
 * ontem um aviso possivelmente falso hoje.
 *
 * O primeiro dia de ruptura é o que a resposta destaca: saber que faltará
 * dinheiro em algum momento dos próximos 60 dias não muda decisão nenhuma;
 * saber que falta na terça, sim.
 */
@Injectable()
export class CashAlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cashFlow: CashFlowService,
  ) {}

  async create(companyId: string, dto: CreateCashAlertDto, userId: string) {
    await this.assertBankAccount(companyId, dto.bankAccountId);

    try {
      return await this.prisma.db.cashAlert.create({
        data: {
          companyId,
          name: dto.name,
          bankAccountId: dto.bankAccountId,
          minimumBalance: new Prisma.Decimal(dto.minimumBalance),
          daysAhead: dto.daysAhead ?? 7,
          isActive: dto.isActive ?? true,
          createdById: userId,
        },
        select: alertSelect,
      });
    } catch (error) {
      throw this.translateUniqueness(error);
    }
  }

  findAll(companyId: string, isActive?: boolean) {
    return this.prisma.db.cashAlert.findMany({
      where: { companyId, ...(isActive !== undefined ? { isActive } : {}) },
      select: alertSelect,
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
  }

  async findOne(companyId: string, id: string) {
    const alert = await this.prisma.db.cashAlert.findFirst({
      where: { id, companyId },
      select: alertSelect,
    });
    if (!alert) {
      throw new NotFoundException('Alerta de caixa não encontrado.');
    }
    return alert;
  }

  async update(companyId: string, id: string, dto: UpdateCashAlertDto) {
    await this.findOne(companyId, id);
    if (dto.bankAccountId !== undefined) {
      await this.assertBankAccount(companyId, dto.bankAccountId);
    }

    try {
      return await this.prisma.db.cashAlert.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.bankAccountId !== undefined ? { bankAccountId: dto.bankAccountId } : {}),
          ...(dto.minimumBalance !== undefined
            ? { minimumBalance: new Prisma.Decimal(dto.minimumBalance) }
            : {}),
          ...(dto.daysAhead !== undefined ? { daysAhead: dto.daysAhead } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
        select: alertSelect,
      });
    } catch (error) {
      throw this.translateUniqueness(error);
    }
  }

  /** Desativa o alerta. A configuração permanece: religar não é reconfigurar. */
  async deactivate(companyId: string, id: string) {
    await this.findOne(companyId, id);
    await this.prisma.db.cashAlert.update({ where: { id }, data: { isActive: false } });
  }

  /** Avalia todos os alertas ativos da empresa (RF-105). */
  async evaluateAll(companyId: string) {
    const alerts = await this.findAll(companyId, true);
    const evaluations = [];

    for (const alert of alerts) {
      evaluations.push(await this.evaluateAlert(companyId, alert));
    }

    return {
      evaluatedAt: formatDateOnly(this.today()),
      breached: evaluations.filter((e) => e.breached).length,
      alerts: evaluations,
    };
  }

  /** Avalia um alerta específico, ativo ou não — útil para simular a mudança. */
  async evaluate(companyId: string, id: string) {
    return this.evaluateAlert(companyId, await this.findOne(companyId, id));
  }

  private async evaluateAlert(
    companyId: string,
    alert: {
      id: string;
      name: string;
      bankAccountId: string | null;
      minimumBalance: Prisma.Decimal;
      daysAhead: number;
    },
  ) {
    const from = this.today();
    const to = new Date(from.getTime() + alert.daysAhead * DAY_MS);

    const openingBalance = await this.cashFlow.currentCashBalance(companyId, alert.bankAccountId);
    const movements = await this.cashFlow.dailyNet(companyId, from, to);
    const byDay = new Map(movements.map((row) => [formatDateOnly(row.dia), row]));

    let balance = openingBalance;
    let breachDate: string | null = null;
    let lowestBalance = openingBalance;
    let lowestDate = formatDateOnly(from);

    for (let offset = 0; offset <= alert.daysAhead; offset += 1) {
      const day = formatDateOnly(new Date(from.getTime() + offset * DAY_MS));
      const row = byDay.get(day);
      if (row) {
        balance = balance.plus(row.entradas).minus(row.saidas);
      }

      if (balance.lessThan(lowestBalance)) {
        lowestBalance = balance;
        lowestDate = day;
      }
      // O primeiro cruzamento é o que importa: é a data em que a decisão
      // precisa ser tomada, e as seguintes são consequência dela.
      if (breachDate === null && balance.lessThan(alert.minimumBalance)) {
        breachDate = day;
      }
    }

    return {
      alert: {
        id: alert.id,
        name: alert.name,
        bankAccountId: alert.bankAccountId,
        minimumBalance: alert.minimumBalance,
        daysAhead: alert.daysAhead,
      },
      horizon: { from: formatDateOnly(from), to: formatDateOnly(to) },
      openingBalance,
      closingBalance: balance,
      lowestBalance,
      lowestBalanceDate: lowestDate,
      breached: breachDate !== null,
      breachDate,
      // Quanto falta para não cruzar o mínimo no pior dia — o número que vira
      // decisão (antecipar recebimento, adiar pagamento, buscar crédito).
      shortfall: lowestBalance.lessThan(alert.minimumBalance)
        ? alert.minimumBalance.minus(lowestBalance)
        : ZERO,
    };
  }

  /**
   * A conta é de outro módulo (M09, Sprint 10) e ainda não tem serviço próprio:
   * a checagem é direta, mas presa à empresa ativa — sem isso, um alerta poderia
   * apontar para a conta de outra empresa e revelar o saldo dela.
   */
  private async assertBankAccount(companyId: string, bankAccountId?: string): Promise<void> {
    if (!bankAccountId) return;

    const [row] = await this.prisma.db.$queryRaw<{ id: string }[]>`
      SELECT id FROM conta_bancaria
       WHERE id = ${bankAccountId}::uuid AND empresa_id = ${companyId}::uuid
    `;
    if (!row) {
      throw new BadRequestException('Conta bancária não encontrada nesta empresa.');
    }
  }

  /** O índice parcial de bd/10 vira uma mensagem, não um 500. */
  private translateUniqueness(error: unknown): Error {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return new ConflictException(
        'Já existe um alerta ativo para este caixa. Edite o existente em vez de criar um segundo aviso do mesmo problema.',
      );
    }
    return error instanceof Error ? error : new Error(String(error));
  }

  /** Hoje como dia civil — o horizonte do alerta é contado em dias. */
  private today(): Date {
    return toDateOnly(formatDateOnly(new Date()));
  }
}
