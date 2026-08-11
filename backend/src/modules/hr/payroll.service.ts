import { Injectable } from '@nestjs/common';
import { AuditEvent, EmployeeStatus, PayrollItemType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService, AUDIT_ENTITY } from '../../common/audit/audit.service';
import { formatDateOnly } from '../../common/utils/date-only';
import { QueryPayrollDto } from './dto/query-payroll.dto';

const ZERO = new Prisma.Decimal(0);
const HUNDRED = new Prisma.Decimal(100);

/** Verbas que somam a favor do funcionário. */
const EARNING_TYPES: PayrollItemType[] = [
  PayrollItemType.SALARIO,
  PayrollItemType.BENEFICIO,
  PayrollItemType.ADICIONAL,
];

/** Linha da consolidação: uma verba apurada para um funcionário. */
export interface PayrollLine {
  payrollItemId: string | null;
  code: string;
  name: string;
  type: PayrollItemType;
  amount: string;
  /** Destino contábil da verba (RF-021). */
  categoryId: string | null;
  ledgerAccountId: string | null;
  affectsInss: boolean;
  affectsIrrf: boolean;
  affectsFgts: boolean;
}

export interface PayrollEmployeeSummary {
  employeeId: string;
  registration: string;
  name: string;
  taxId: string;
  positionId: string | null;
  departmentId: string | null;
  costCenterId: string | null;
  status: EmployeeStatus;
  hireDate: string;
  terminationDate: string | null;
  lines: PayrollLine[];
  totals: {
    earnings: string;
    deductions: string;
    employerCharges: string;
    net: string;
    inssBase: string;
    irrfBase: string;
    fgtsBase: string;
  };
}

/**
 * Consolidação para folha e contabilidade (RF-021).
 *
 * Apura, para uma competência, as verbas vigentes de cada funcionário e o
 * destino contábil de cada uma. Não calcula encargos legais nem gera a folha —
 * isso é do M14; aqui a responsabilidade é **disponibilizar a informação**, que
 * é o que o requisito pede.
 *
 * Somente leitura, e cada consulta vai à trilha como EXPORTACAO: é o retrato
 * salarial da empresa inteira saindo pela API, e saber quem o levou importa
 * tanto quanto restringir quem pode (RF-114/RNF-010).
 */
@Injectable()
export class PayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async summary(companyId: string, query: QueryPayrollDto) {
    const { start, end } = this.competenceRange(query.competence);

    const employees = await this.prisma.db.employee.findMany({
      where: {
        companyId,
        ...(query.employeeId ? { id: query.employeeId } : {}),
        ...(query.costCenterId ? { costCenterId: query.costCenterId } : {}),
        ...(query.departmentId ? { departmentId: query.departmentId } : {}),
        // Admitido até o fim da competência e ainda não desligado antes dela.
        hireDate: { lte: end },
        OR: [{ terminationDate: null }, { terminationDate: { gte: start } }],
      },
      orderBy: { name: 'asc' },
      include: {
        payrollItems: {
          where: {
            effectiveFrom: { lte: end },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: start } }],
          },
          include: { payrollItem: true },
        },
      },
    });

    const data = employees.map((employee) => this.summarize(employee));

    await this.audit.record({
      event: AuditEvent.EXPORTACAO,
      entity: AUDIT_ENTITY.EMPLOYEE,
      note: `Consolidação de folha da competência ${query.competence}: ${data.length} funcionário(s).`,
    });

    return {
      competence: query.competence,
      periodStart: formatDateOnly(start),
      periodEnd: formatDateOnly(end),
      employees: data,
      totals: this.companyTotals(data),
    };
  }

  private summarize(
    employee: Prisma.EmployeeGetPayload<{
      include: { payrollItems: { include: { payrollItem: true } } };
    }>,
  ): PayrollEmployeeSummary {
    const baseSalary = employee.baseSalary ?? ZERO;
    const lines: PayrollLine[] = employee.payrollItems.map((assignment) => ({
      payrollItemId: assignment.payrollItem.id,
      code: assignment.payrollItem.code,
      name: assignment.payrollItem.name,
      type: assignment.payrollItem.type,
      amount: this.resolveAmount(assignment.amount, assignment.percentage, baseSalary).toFixed(2),
      categoryId: assignment.payrollItem.categoryId,
      ledgerAccountId: assignment.payrollItem.ledgerAccountId,
      affectsInss: assignment.payrollItem.affectsInss,
      affectsIrrf: assignment.payrollItem.affectsIrrf,
      affectsFgts: assignment.payrollItem.affectsFgts,
    }));

    // Sem verba de salário atribuída, o salário base do cadastro é a referência
    // — do contrário a competência sairia sem o principal provento.
    const hasSalary = lines.some((line) => line.type === PayrollItemType.SALARIO);
    if (!hasSalary && baseSalary.greaterThan(ZERO)) {
      lines.unshift({
        payrollItemId: null,
        code: 'SALARIO_BASE',
        name: 'Salário base (cadastro)',
        type: PayrollItemType.SALARIO,
        amount: baseSalary.toFixed(2),
        categoryId: null,
        ledgerAccountId: null,
        affectsInss: true,
        affectsIrrf: true,
        affectsFgts: true,
      });
    }

    return {
      employeeId: employee.id,
      registration: employee.registration,
      name: employee.name,
      taxId: employee.taxId,
      positionId: employee.positionId,
      departmentId: employee.departmentId,
      costCenterId: employee.costCenterId,
      status: employee.status,
      hireDate: formatDateOnly(employee.hireDate),
      terminationDate: employee.terminationDate ? formatDateOnly(employee.terminationDate) : null,
      lines,
      totals: this.employeeTotals(lines),
    };
  }

  /** Verba por valor fixo ou percentual do salário base, arredondada a 2 casas. */
  private resolveAmount(
    amount: Prisma.Decimal | null,
    percentage: Prisma.Decimal | null,
    baseSalary: Prisma.Decimal,
  ): Prisma.Decimal {
    if (amount != null) return amount;
    if (percentage != null) {
      return baseSalary.mul(percentage).div(HUNDRED).toDecimalPlaces(2);
    }
    return ZERO;
  }

  private employeeTotals(lines: PayrollLine[]): PayrollEmployeeSummary['totals'] {
    const sum = (predicate: (line: PayrollLine) => boolean) =>
      lines.filter(predicate).reduce((acc, line) => acc.add(new Prisma.Decimal(line.amount)), ZERO);

    const earnings = sum((line) => EARNING_TYPES.includes(line.type));
    const deductions = sum((line) => line.type === PayrollItemType.DESCONTO);
    const employerCharges = sum((line) => line.type === PayrollItemType.ENCARGO);

    const base = (flag: keyof Pick<PayrollLine, 'affectsInss' | 'affectsIrrf' | 'affectsFgts'>) =>
      sum((line) => EARNING_TYPES.includes(line.type) && line[flag]);

    return {
      earnings: earnings.toFixed(2),
      deductions: deductions.toFixed(2),
      employerCharges: employerCharges.toFixed(2),
      net: earnings.sub(deductions).toFixed(2),
      inssBase: base('affectsInss').toFixed(2),
      irrfBase: base('affectsIrrf').toFixed(2),
      fgtsBase: base('affectsFgts').toFixed(2),
    };
  }

  private companyTotals(employees: PayrollEmployeeSummary[]) {
    const sum = (pick: (e: PayrollEmployeeSummary) => string) =>
      employees.reduce((acc, e) => acc.add(new Prisma.Decimal(pick(e))), ZERO).toFixed(2);

    return {
      employees: employees.length,
      earnings: sum((e) => e.totals.earnings),
      deductions: sum((e) => e.totals.deductions),
      employerCharges: sum((e) => e.totals.employerCharges),
      net: sum((e) => e.totals.net),
    };
  }

  /** `YYYY-MM` → primeiro e último dia da competência, em UTC. */
  private competenceRange(competence: string) {
    const [year, month] = competence.split('-').map(Number);
    return {
      start: new Date(Date.UTC(year, month - 1, 1)),
      end: new Date(Date.UTC(year, month, 0)),
    };
  }
}
