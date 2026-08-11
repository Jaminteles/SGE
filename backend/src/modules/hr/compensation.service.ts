import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { toDateOnly } from '../../common/utils/date-only';
import { HrReferencesService } from './hr-references.service';
import { EmployeesService } from './employees.service';
import { CreateCompensationDto } from './dto/create-compensation.dto';
import { UpdateCompensationDto } from './dto/update-compensation.dto';

const compensationInclude = {
  payrollItem: { select: { id: true, code: true, name: true, type: true } },
} satisfies Prisma.EmployeePayrollItemInclude;

/**
 * Remuneração do funcionário (RF-017) — `gestao.funcionario_verba`.
 *
 * Salário, benefícios e descontos vigentes por período. A sobreposição de
 * vigências da mesma verba é recusada pelo banco (bd/06): duas linhas ativas ao
 * mesmo tempo dobrariam o valor na folha sem nenhum sinal de erro.
 */
@Injectable()
export class CompensationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employees: EmployeesService,
    private readonly references: HrReferencesService,
  ) {}

  async create(companyId: string, employeeId: string, dto: CreateCompensationDto) {
    await this.employees.findOne(companyId, employeeId);
    await this.references.assert(companyId, { payrollItemId: dto.payrollItemId });

    const { effectiveFrom, effectiveTo } = this.parsePeriod(dto.effectiveFrom, dto.effectiveTo);
    this.assertValue(dto.amount, dto.percentage);

    return this.prisma.db.employeePayrollItem.create({
      data: {
        companyId,
        employeeId,
        payrollItemId: dto.payrollItemId,
        amount: dto.amount != null ? new Prisma.Decimal(dto.amount) : null,
        percentage: dto.percentage != null ? new Prisma.Decimal(dto.percentage) : null,
        effectiveFrom,
        effectiveTo,
        note: dto.note,
      },
      include: compensationInclude,
    });
  }

  async findAll(companyId: string, employeeId: string) {
    await this.employees.findOne(companyId, employeeId);
    return this.prisma.db.employeePayrollItem.findMany({
      where: { companyId, employeeId },
      include: compensationInclude,
      orderBy: [{ effectiveFrom: 'desc' }],
    });
  }

  async update(companyId: string, employeeId: string, id: string, dto: UpdateCompensationDto) {
    const current = await this.load(companyId, employeeId, id);

    const { effectiveFrom, effectiveTo } = this.parsePeriod(
      dto.effectiveFrom,
      dto.effectiveTo,
      current,
    );
    this.assertValue(
      dto.amount !== undefined ? dto.amount : current.amount?.toString(),
      dto.percentage !== undefined ? dto.percentage : current.percentage?.toString(),
    );

    return this.prisma.db.employeePayrollItem.update({
      where: { id: current.id },
      data: {
        ...(dto.amount !== undefined
          ? { amount: dto.amount != null ? new Prisma.Decimal(dto.amount) : null }
          : {}),
        ...(dto.percentage !== undefined
          ? { percentage: dto.percentage != null ? new Prisma.Decimal(dto.percentage) : null }
          : {}),
        ...(dto.effectiveFrom !== undefined ? { effectiveFrom } : {}),
        ...(dto.effectiveTo !== undefined ? { effectiveTo } : {}),
        ...(dto.note !== undefined ? { note: dto.note } : {}),
      },
      include: compensationInclude,
    });
  }

  /**
   * Encerra a vigência em vez de apagar: a verba já pode ter composto uma folha,
   * e a competência anterior precisa continuar reproduzível (RF-021).
   */
  async close(companyId: string, employeeId: string, id: string, endDate?: string) {
    const current = await this.load(companyId, employeeId, id);
    const effectiveTo = endDate ? toDateOnly(endDate) : new Date();

    if (effectiveTo < current.effectiveFrom) {
      throw new BadRequestException('O fim da vigência não pode ser anterior ao início.');
    }

    return this.prisma.db.employeePayrollItem.update({
      where: { id: current.id },
      data: { effectiveTo },
      include: compensationInclude,
    });
  }

  private async load(companyId: string, employeeId: string, id: string) {
    const row = await this.prisma.db.employeePayrollItem.findFirst({
      where: { id, companyId, employeeId },
    });
    if (!row) {
      throw new NotFoundException('Verba do funcionário não encontrada.');
    }
    return row;
  }

  private parsePeriod(
    from?: string,
    to?: string,
    current?: { effectiveFrom: Date; effectiveTo: Date | null },
  ) {
    const effectiveFrom = from ? toDateOnly(from) : (current?.effectiveFrom ?? new Date());
    const effectiveTo = to ? toDateOnly(to) : (current?.effectiveTo ?? null);

    if (effectiveTo && effectiveTo < effectiveFrom) {
      throw new BadRequestException('O fim da vigência não pode ser anterior ao início.');
    }
    return { effectiveFrom, effectiveTo };
  }

  /** O banco exige valor ou percentual; a mensagem daqui é mais útil que a dele. */
  private assertValue(amount?: string | null, percentage?: string | null) {
    if (amount == null && percentage == null) {
      throw new BadRequestException('Informe um valor fixo ou um percentual para a verba.');
    }
    if (amount != null && percentage != null) {
      throw new BadRequestException('Informe valor fixo ou percentual, não os dois.');
    }
  }
}
