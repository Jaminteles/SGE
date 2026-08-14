import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../../common/authorization/authenticated-user';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { PaginatedResult } from '../../common/dto/paginated-result';
import { CreateApprovalThresholdDto } from './dto/create-approval-threshold.dto';
import { UpdateApprovalThresholdDto } from './dto/update-approval-threshold.dto';

/**
 * Alçadas de aprovação (RF-012, RN-003) — `gestao.alcada`.
 * Os aprovadores ficam em `gestao.alcada_aprovador`: cada linha aponta para um
 * perfil OU um usuário. A API desta sprint trabalha com aprovação por perfil.
 */
const thresholdInclude = {
  approvers: { include: { role: { select: { id: true, name: true } } } },
} satisfies Prisma.ApprovalThresholdInclude;

type ThresholdRow = Prisma.ApprovalThresholdGetPayload<{ include: typeof thresholdInclude }>;

@Injectable()
export class ApprovalThresholdsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(companyId: string, dto: CreateApprovalThresholdDto) {
    const min = new Prisma.Decimal(dto.minAmount ?? '0');
    const max = dto.maxAmount != null ? new Prisma.Decimal(dto.maxAmount) : null;
    this.validateRange(min, max);
    await this.ensureRole(companyId, dto.requiredRoleId);

    const row = await this.prisma.db.approvalThreshold.create({
      data: {
        companyId,
        name: dto.name ?? dto.operation,
        operation: dto.operation,
        minAmount: min,
        maxAmount: max,
        ...(dto.level !== undefined ? { level: dto.level } : {}),
        ...(dto.minApprovers !== undefined ? { minApprovers: dto.minApprovers } : {}),
        approvers: { create: [{ roleId: dto.requiredRoleId }] },
      },
      include: thresholdInclude,
    });
    return this.toResponse(row);
  }

  async findAll(companyId: string, query: PaginationQueryDto) {
    const where: Prisma.ApprovalThresholdWhereInput = {
      companyId,
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.q ? { operation: { contains: query.q, mode: 'insensitive' } } : {}),
    };

    const rows = await this.prisma.db.approvalThreshold.findMany({
      where,
      include: thresholdInclude,
      orderBy: [{ operation: 'asc' }, { minAmount: 'asc' }],
      skip: query.skip,
      take: query.take,
    });
    const total = await this.prisma.db.approvalThreshold.count({ where });

    return new PaginatedResult(
      rows.map((r) => this.toResponse(r)),
      total,
      query.page,
      query.pageSize,
    );
  }

  async findOne(companyId: string, id: string) {
    return this.toResponse(await this.load(companyId, id));
  }

  async update(companyId: string, id: string, dto: UpdateApprovalThresholdDto) {
    const current = await this.load(companyId, id);

    const min = dto.minAmount != null ? new Prisma.Decimal(dto.minAmount) : current.minAmount;
    const max =
      dto.maxAmount !== undefined
        ? dto.maxAmount != null
          ? new Prisma.Decimal(dto.maxAmount)
          : null
        : current.maxAmount;
    this.validateRange(min, max);

    if (dto.requiredRoleId) {
      await this.ensureRole(companyId, dto.requiredRoleId);
    }

    const row = await this.prisma.db.approvalThreshold.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.operation !== undefined ? { operation: dto.operation } : {}),
        ...(dto.minAmount != null ? { minAmount: min } : {}),
        ...(dto.maxAmount !== undefined ? { maxAmount: max } : {}),
        ...(dto.level !== undefined ? { level: dto.level } : {}),
        ...(dto.minApprovers !== undefined ? { minApprovers: dto.minApprovers } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        // Substitui o aprovador por perfil de forma atômica.
        ...(dto.requiredRoleId !== undefined
          ? { approvers: { deleteMany: {}, create: [{ roleId: dto.requiredRoleId }] } }
          : {}),
      },
      include: thresholdInclude,
    });
    return this.toResponse(row);
  }

  async remove(companyId: string, id: string) {
    await this.load(companyId, id);
    await this.prisma.db.approvalThreshold.delete({ where: { id } });
  }

  /**
   * Avalia se uma operação, para um dado valor, exige aprovação por alçada
   * (RF-012, RN-003). Retorna os perfis autorizados a aprovar.
   */
  async evaluate(companyId: string, operation: string, amount: string) {
    const value = new Prisma.Decimal(amount);
    const rows = await this.prisma.db.approvalThreshold.findMany({
      where: {
        companyId,
        operation,
        isActive: true,
        minAmount: { lte: value },
        OR: [{ maxAmount: null }, { maxAmount: { gte: value } }],
      },
      include: thresholdInclude,
      orderBy: { minAmount: 'asc' },
    });

    const matched = rows.map((r) => this.toResponse(r));
    const roles = new Map(
      rows.flatMap((r) => r.approvers.filter((a) => a.role).map((a) => [a.role!.id, a.role!])),
    );

    return {
      operation,
      amount: value.toFixed(2),
      requiresApproval: matched.length > 0,
      authorizedRoles: [...roles.values()],
      matchedThresholds: matched,
    };
  }

  /**
   * Recusa a decisão de quem não alcança a faixa configurada (RN-003).
   *
   * Sem alçada cadastrada para a operação, a permissão de aprovação basta — a
   * alçada é um controle adicional sobre valor, não um substituto do RBAC.
   * Super admin passa: ele administra a plataforma e é quem configura as faixas.
   *
   * Vive aqui, e não em cada módulo que aprova, porque reembolso (M03), título
   * (M08) e pedido de compra (M06) fazem a mesma pergunta — e uma cópia que
   * envelhece é uma alçada que deixou de valer sem ninguém perceber.
   */
  async assertAuthority(
    companyId: string,
    approver: AuthenticatedUser,
    operation: string,
    amount: Prisma.Decimal,
  ): Promise<void> {
    const evaluation = await this.evaluate(companyId, operation, amount.toFixed(2));
    if (!evaluation.requiresApproval || approver.isSuperAdmin) {
      return;
    }

    const authorized = new Set(evaluation.authorizedRoles.map((role) => role.id));
    const memberships = await this.prisma.db.membership.findMany({
      where: { userId: approver.id, companyId, isActive: true },
      select: { roleId: true },
    });

    if (!memberships.some((m) => authorized.has(m.roleId))) {
      throw new ForbiddenException(
        `Valor acima da sua alçada de aprovação para ${operation} (RN-003).`,
      );
    }
  }

  private async load(companyId: string, id: string): Promise<ThresholdRow> {
    const threshold = await this.prisma.db.approvalThreshold.findFirst({
      where: { id, companyId },
      include: thresholdInclude,
    });
    if (!threshold) {
      throw new NotFoundException('Alçada não encontrada.');
    }
    return threshold;
  }

  private toResponse(row: ThresholdRow) {
    return {
      id: row.id,
      name: row.name,
      operation: row.operation,
      minAmount: row.minAmount,
      maxAmount: row.maxAmount,
      level: row.level,
      minApprovers: row.minApprovers,
      isActive: row.isActive,
      requiredRoles: row.approvers.filter((a) => a.role).map((a) => a.role),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private validateRange(min: Prisma.Decimal, max: Prisma.Decimal | null) {
    if (min.isNegative()) {
      throw new BadRequestException('minAmount não pode ser negativo.');
    }
    if (max != null && max.lessThan(min)) {
      throw new BadRequestException('maxAmount deve ser maior ou igual a minAmount.');
    }
  }

  private async ensureRole(companyId: string, roleId: string) {
    const role = await this.prisma.db.role.findFirst({
      where: { id: roleId, OR: [{ companyId }, { companyId: null }] },
      select: { id: true },
    });
    if (!role) {
      throw new BadRequestException('Perfil informado não pertence a esta empresa.');
    }
  }
}
