import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { AuditService } from '../../common/audit/audit.service';
import { AuthenticatedUser } from '../../common/authorization/authenticated-user';
import { ReportExportService } from '../../common/export/report-export.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DashboardService } from './dashboard.service';
import { ExportReportDto, ReportFilterDto } from './dto/report-filter.dto';
import { ReportGenerationService } from './report-generation.service';
import { StatementReportsService } from './statement-reports.service';

const USER: AuthenticatedUser = { id: 'user-1', email: 'gestor@empresa.com', isSuperAdmin: false };
const FILTER = { from: '2026-06-01', to: '2026-06-30' };

function buildService(grantedPermissions: string[] = []) {
  const dashboards = {
    financial: jest.fn().mockResolvedValue({
      openPortfolio: {
        receivable: new Prisma.Decimal('100'),
        payable: new Prisma.Decimal('0'),
        overdueReceivable: new Prisma.Decimal('0'),
        overduePayable: new Prisma.Decimal('0'),
        installments: 1,
      },
      realized: {
        inflow: new Prisma.Decimal('50'),
        outflow: new Prisma.Decimal('0'),
        net: new Prisma.Decimal('50'),
        settlements: 1,
        interest: new Prisma.Decimal('0'),
        discount: new Prisma.Decimal('0'),
      },
      byMonth: [],
    }),
  } as unknown as DashboardService;

  const statements = {
    accountingStatement: jest.fn().mockResolvedValue({
      trialBalance: {
        rows: [],
        totalDebit: new Prisma.Decimal('0'),
        totalCredit: new Prisma.Decimal('0'),
      },
      incomeStatement: {
        revenue: { lines: [] },
        cost: { lines: [] },
        expense: { lines: [] },
        netResult: new Prisma.Decimal('0'),
      },
    }),
  } as unknown as StatementReportsService;

  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;

  const prisma = {
    db: {
      membership: {
        findFirst: jest.fn().mockResolvedValue({
          role: {
            permissions: grantedPermissions.map((code) => {
              const [resource, action] = code.split(':');
              return { permission: { resource, action } };
            }),
          },
        }),
      },
    },
  } as unknown as PrismaService;

  const service = new ReportGenerationService(
    dashboards,
    statements,
    new ReportExportService(),
    audit,
    prisma,
  );

  return { service, audit, dashboards, statements, prisma };
}

describe('ReportGenerationService.export (RF-113)', () => {
  it('exporta relatório gerencial e registra a saída do dado na trilha', async () => {
    const { service, audit } = buildService();
    const dto: ExportReportDto = { ...FILTER, report: 'financeiro', format: 'csv' };

    const rendered = await service.export('empresa-1', dto, USER);

    expect(rendered.filename.endsWith('.csv')).toBe(true);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'EXPORTACAO', entity: 'relatorio', userId: 'user-1' }),
    );
  });

  it('não registra o conteúdo do relatório na auditoria', async () => {
    const { service, audit } = buildService();

    await service.export('empresa-1', { ...FILTER, report: 'financeiro', format: 'csv' }, USER);

    const [entry] = (audit.record as unknown as jest.Mock).mock.calls[0] as [
      { note: string; currentValue?: unknown },
    ];
    expect(entry.currentValue).toBeUndefined();
    expect(entry.note).not.toContain('A receber em aberto');
  });

  it('recusa o relatório contábil a quem não pode ler contabilidade (RF-111)', async () => {
    const { service, audit } = buildService([]);

    await expect(
      service.export('empresa-1', { ...FILTER, report: 'contabil', format: 'pdf' }, USER),
    ).rejects.toBeInstanceOf(ForbiddenException);

    // Recusado antes de consultar qualquer dado e sem deixar rastro de exportação.
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('libera o relatório contábil a quem tem a permissão do módulo de origem', async () => {
    const { service, statements } = buildService(['accounting-reports:READ']);

    await service.export('empresa-1', { ...FILTER, report: 'contabil', format: 'csv' }, USER);

    expect(statements.accountingStatement).toHaveBeenCalledWith('empresa-1', expect.anything());
  });

  it('consulta a associação do usuário na empresa ativa, e não em outra', async () => {
    const { service, prisma } = buildService(['accounting-reports:READ']);

    await service.export('empresa-1', { ...FILTER, report: 'contabil', format: 'csv' }, USER);

    expect(prisma.db.membership.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1', companyId: 'empresa-1', isActive: true },
      }),
    );
  });
});

describe('ReportFilterDto (RF-112)', () => {
  it('recusa empresa vinda do cliente: ela vem do header e nada mais', () => {
    const dto = plainToInstance(ReportFilterDto, {
      ...FILTER,
      companyId: 'empresa-2',
      empresa_id: 'empresa-2',
    });

    // Sem a propriedade no DTO, o ValidationPipe global (`whitelist` +
    // `forbidNonWhitelisted`) rejeita a requisição inteira — a troca de empresa
    // pelo corpo não chega ao serviço.
    const errors = validateSync(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors).toHaveLength(2);
    expect(errors.map((error) => error.property).sort()).toEqual(['companyId', 'empresa_id']);
  });

  it('exige período e recusa uuid inválido nos filtros', () => {
    const missing = validateSync(plainToInstance(ReportFilterDto, {}));
    expect(missing.length).toBeGreaterThan(0);

    const badUuid = validateSync(
      plainToInstance(ReportFilterDto, { ...FILTER, branchId: 'nao-e-uuid' }),
    );
    expect(badUuid).toHaveLength(1);
  });

  it('recusa relatório fora do catálogo e formato desconhecido', () => {
    const errors = validateSync(
      plainToInstance(ExportReportDto, { ...FILTER, report: 'tudo', format: 'exe' }),
    );

    expect(errors).toHaveLength(2);
  });
});
