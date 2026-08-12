import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { AuditEvent, Prisma, ReimbursementStatus } from '@prisma/client';
import { ReimbursementsService } from './reimbursements.service';
import { ReferencesService } from '../../common/references/references.service';
import { ApprovalThresholdsService } from '../approvals/approval-thresholds.service';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../../common/authorization/authenticated-user';

const APPROVER: AuthenticatedUser = {
  id: 'user-gestor',
  email: 'gestor@sge.local',
  isSuperAdmin: false,
};

function reimbursement(overrides: Record<string, unknown> = {}) {
  return {
    id: 'reemb-1',
    companyId: 'empresa-1',
    number: 'REEMB-2026-000001',
    status: ReimbursementStatus.SOLICITADO,
    totalAmount: new Prisma.Decimal('250.00'),
    employee: { id: 'func-1', registration: '0001', name: 'Maria', userId: 'user-maria' },
    items: [{ id: 'item-1', documentId: 'doc-1' }],
    ...overrides,
  };
}

function buildService(row: Record<string, unknown> = reimbursement(), requiresApproval = false) {
  const delegate = {
    create: jest.fn().mockResolvedValue({ id: 'reemb-1' }),
    findFirst: jest.fn().mockResolvedValue(row),
    findMany: jest.fn().mockResolvedValue([row]),
    count: jest.fn().mockResolvedValue(1),
    update: jest.fn().mockResolvedValue(row),
  };
  const membership = { findMany: jest.fn().mockResolvedValue([{ roleId: 'perfil-financeiro' }]) };

  const prisma = {
    db: {
      reimbursement: delegate,
      membership,
      $queryRaw: jest.fn().mockResolvedValue([{ numero: 'REEMB-2026-000001' }]),
    },
    transaction: <T>(fn: () => Promise<T>) => fn(),
  } as unknown as PrismaService;

  const references = {
    assert: jest.fn().mockResolvedValue(undefined),
  } as unknown as ReferencesService;
  const thresholds = {
    evaluate: jest.fn().mockResolvedValue({
      requiresApproval,
      authorizedRoles: requiresApproval ? [{ id: 'perfil-diretor', name: 'DIRETOR' }] : [],
    }),
  } as unknown as ApprovalThresholdsService;
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;

  return {
    service: new ReimbursementsService(prisma, references, thresholds, audit),
    delegate,
    membership,
    thresholds,
    audit,
    prisma,
  };
}

describe('ReimbursementsService', () => {
  describe('máquina de estados (RF-018)', () => {
    it('recusa aprovar um rascunho — a solicitação não pode ser pulada', async () => {
      const { service } = buildService(reimbursement({ status: ReimbursementStatus.RASCUNHO }));

      await expect(service.approve('empresa-1', 'reemb-1', {}, APPROVER)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('recusa reabrir um reembolso já reprovado', async () => {
      const { service } = buildService(reimbursement({ status: ReimbursementStatus.REPROVADO }));

      await expect(service.cancel('empresa-1', 'reemb-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('exige comprovante em toda despesa antes de solicitar (RF-019)', async () => {
      const { service } = buildService(
        reimbursement({
          status: ReimbursementStatus.RASCUNHO,
          items: [{ id: 'item-1', documentId: null }],
        }),
      );

      await expect(service.submit('empresa-1', 'reemb-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('aprovação (RN-003)', () => {
    it('impede o solicitante de aprovar o próprio reembolso', async () => {
      const { service } = buildService();

      await expect(
        service.approve('empresa-1', 'reemb-1', {}, { ...APPROVER, id: 'user-maria' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('recusa valor aprovado acima do solicitado', async () => {
      const { service } = buildService();

      await expect(
        service.approve('empresa-1', 'reemb-1', { approvedAmount: '999.00' }, APPROVER),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('bloqueia quem não tem o perfil da alçada para o valor', async () => {
      const { service } = buildService(reimbursement(), true);

      await expect(service.approve('empresa-1', 'reemb-1', {}, APPROVER)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('libera quando o aprovador tem o perfil exigido pela alçada', async () => {
      const { service, membership, delegate } = buildService(reimbursement(), true);
      (membership.findMany as jest.Mock).mockResolvedValue([{ roleId: 'perfil-diretor' }]);

      await service.approve('empresa-1', 'reemb-1', {}, APPROVER);

      expect(delegate.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ReimbursementStatus.APROVADO,
            approvedBy: APPROVER.id,
          }),
        }),
      );
    });

    it('aprova pelo total quando o valor não é informado e registra na trilha', async () => {
      const { service, delegate, audit } = buildService();

      await service.approve('empresa-1', 'reemb-1', {}, APPROVER);

      const data = (delegate.update as jest.Mock).mock.calls[0][0].data as {
        approvedAmount: Prisma.Decimal;
      };
      expect(data.approvedAmount.toFixed(2)).toBe('250.00');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ event: AuditEvent.APROVACAO, entityId: 'reemb-1' }),
      );
    });

    it('registra a reprovação com o motivo na trilha', async () => {
      const { service, audit } = buildService();

      await service.reject('empresa-1', 'reemb-1', { reason: 'Sem nota fiscal' }, APPROVER);

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          event: AuditEvent.REPROVACAO,
          note: expect.stringContaining('Sem nota fiscal'),
        }),
      );
    });
  });

  describe('criação', () => {
    it('recusa despesa com valor zerado ou negativo', async () => {
      const { service } = buildService();

      await expect(
        service.create('empresa-1', {
          employeeId: 'func-1',
          description: 'Viagem',
          items: [{ description: 'Táxi', expenseDate: '2026-09-01', amount: '0.00' }],
        } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('não aceita número nem valor total do cliente: usa o banco', async () => {
      const { service, delegate, prisma } = buildService();

      await service.create('empresa-1', {
        employeeId: 'func-1',
        description: 'Viagem',
        items: [{ description: 'Táxi', expenseDate: '2026-09-01', amount: '80.00' }],
      } as never);

      expect(prisma.db.$queryRaw).toHaveBeenCalled();
      const data = (delegate.create as jest.Mock).mock.calls[0][0].data as Record<string, unknown>;
      expect(data.number).toBe('REEMB-2026-000001');
      expect(data).not.toHaveProperty('totalAmount');
    });
  });
});
