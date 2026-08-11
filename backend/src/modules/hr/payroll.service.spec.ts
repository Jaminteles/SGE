import { AuditEvent, EmployeeStatus, PayrollItemType, Prisma } from '@prisma/client';
import { PayrollService } from './payroll.service';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';

function payrollItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'verba-1',
    code: 'SAL',
    name: 'Salário',
    type: PayrollItemType.SALARIO,
    categoryId: 'cat-1',
    ledgerAccountId: 'conta-1',
    affectsInss: true,
    affectsIrrf: true,
    affectsFgts: true,
    ...overrides,
  };
}

function employee(assignments: Record<string, unknown>[] = []) {
  return {
    id: 'func-1',
    registration: '0001',
    name: 'Maria Souza',
    taxId: '52998224725',
    positionId: 'cargo-1',
    departmentId: 'dep-1',
    costCenterId: 'cc-1',
    status: EmployeeStatus.ATIVO,
    hireDate: new Date('2026-01-05T00:00:00.000Z'),
    terminationDate: null,
    baseSalary: new Prisma.Decimal('4000.00'),
    payrollItems: assignments,
  };
}

function buildService(employees: Record<string, unknown>[]) {
  const findMany = jest.fn().mockResolvedValue(employees);
  const prisma = { db: { employee: { findMany } } } as unknown as PrismaService;
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  return { service: new PayrollService(prisma, audit), findMany, audit };
}

describe('PayrollService', () => {
  it('recorta a competência entre o primeiro e o último dia do mês', async () => {
    const { service, findMany } = buildService([]);

    await service.summary('empresa-1', { competence: '2026-09' });

    const where = (findMany as jest.Mock).mock.calls[0][0].where as {
      companyId: string;
      hireDate: { lte: Date };
    };
    expect(where.companyId).toBe('empresa-1');
    expect(where.hireDate.lte.toISOString().slice(0, 10)).toBe('2026-09-30');
  });

  it('usa o salário do cadastro quando não há verba de salário atribuída', async () => {
    const { service } = buildService([employee()]);

    const result = await service.summary('empresa-1', { competence: '2026-09' });

    const [line] = result.employees[0].lines;
    expect(line.code).toBe('SALARIO_BASE');
    expect(line.amount).toBe('4000.00');
  });

  it('resolve verba percentual sobre o salário base', async () => {
    const { service } = buildService([
      employee([
        {
          amount: null,
          percentage: new Prisma.Decimal('12.5'),
          payrollItem: payrollItem({
            id: 'verba-2',
            code: 'ADIC',
            type: PayrollItemType.ADICIONAL,
          }),
        },
      ]),
    ]);

    const result = await service.summary('empresa-1', { competence: '2026-09' });

    const adicional = result.employees[0].lines.find((line) => line.code === 'ADIC');
    expect(adicional?.amount).toBe('500.00');
  });

  it('separa proventos, descontos e encargos e calcula o líquido', async () => {
    const { service } = buildService([
      employee([
        { amount: new Prisma.Decimal('4000.00'), percentage: null, payrollItem: payrollItem() },
        {
          amount: new Prisma.Decimal('300.00'),
          percentage: null,
          payrollItem: payrollItem({
            id: 'verba-3',
            code: 'VT',
            type: PayrollItemType.DESCONTO,
            affectsInss: false,
            affectsIrrf: false,
            affectsFgts: false,
          }),
        },
        {
          amount: new Prisma.Decimal('320.00'),
          percentage: null,
          payrollItem: payrollItem({
            id: 'verba-4',
            code: 'FGTS',
            type: PayrollItemType.ENCARGO,
            affectsInss: false,
            affectsIrrf: false,
            affectsFgts: false,
          }),
        },
      ]),
    ]);

    const { totals } = (await service.summary('empresa-1', { competence: '2026-09' })).employees[0];

    expect(totals.earnings).toBe('4000.00');
    expect(totals.deductions).toBe('300.00');
    expect(totals.employerCharges).toBe('320.00');
    expect(totals.net).toBe('3700.00');
    // Encargo do empregador não compõe base do empregado.
    expect(totals.inssBase).toBe('4000.00');
  });

  // A consulta expõe o quadro salarial inteiro: quem levou precisa ficar registrado.
  it('registra a consulta na trilha como EXPORTACAO (RF-114)', async () => {
    const { service, audit } = buildService([employee()]);

    await service.summary('empresa-1', { competence: '2026-09' });

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ event: AuditEvent.EXPORTACAO }),
    );
  });
});
