import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RecordStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { PaginatedResult } from '../../common/dto/paginated-result';
import { CreateApprovalThresholdDto } from './dto/create-approval-threshold.dto';
import { UpdateApprovalThresholdDto } from './dto/update-approval-threshold.dto';

const thresholdInclude = {
  requiredRole: { select: { id: true, name: true } },
} satisfies Prisma.ApprovalThresholdInclude;

@Injectable()
export class ApprovalThresholdsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(companyId: string, dto: CreateApprovalThresholdDto) {
    const min = new Prisma.Decimal(dto.minAmount ?? '0');
    const max = dto.maxAmount != null ? new Prisma.Decimal(dto.maxAmount) : null;
    this.validateRange(min, max);
    await this.ensureRole(companyId, dto.requiredRoleId);

    return this.prisma.approvalThreshold.create({
      data: {
        companyId,
        operation: dto.operation,
        minAmount: min,
        maxAmount: max,
        requiredRoleId: dto.requiredRoleId,
      },
      include: thresholdInclude,
    });
  }

  async findAll(companyId: string, query: PaginationQueryDto) {
    const where: Prisma.ApprovalThresholdWhereInput = {
      companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.q ? { operation: { contains: query.q, mode: 'insensitive' } } : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.approvalThreshold.findMany({
        where,
        include: thresholdInclude,
        orderBy: [{ operation: 'asc' }, { minAmount: 'asc' }],
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.approvalThreshold.count({ where }),
    ]);

    return new PaginatedResult(data, total, query.page, query.pageSize);
  }

  async findOne(companyId: string, id: string) {
    const threshold = await this.prisma.approvalThreshold.findFirst({
      where: { id, companyId },
      include: thresholdInclude,
    });
    if (!threshold) {
      throw new NotFoundException('Alçada não encontrada.');
    }
    return threshold;
  }

  async update(companyId: string, id: string, dto: UpdateApprovalThresholdDto) {
    const current = await this.findOne(companyId, id);

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

    return this.prisma.approvalThreshold.update({
      where: { id },
      data: {
        ...(dto.operation !== undefined ? { operation: dto.operation } : {}),
        ...(dto.minAmount != null ? { minAmount: min } : {}),
        ...(dto.maxAmount !== undefined ? { maxAmount: max } : {}),
        ...(dto.requiredRoleId !== undefined ? { requiredRoleId: dto.requiredRoleId } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
      include: thresholdInclude,
    });
  }

  async remove(companyId: string, id: string) {
    await this.findOne(companyId, id);
    await this.prisma.approvalThreshold.delete({ where: { id } });
  }

  /**
   * Avalia se uma operação, para um dado valor, exige aprovação por alçada
   * (RF-012, RN-003). Retorna os perfis autorizados a aprovar.
   */
  async evaluate(companyId: string, operation: string, amount: string) {
    const value = new Prisma.Decimal(amount);
    const thresholds = await this.prisma.approvalThreshold.findMany({
      where: {
        companyId,
        operation,
        status: RecordStatus.ACTIVE,
        minAmount: { lte: value },
        OR: [{ maxAmount: null }, { maxAmount: { gte: value } }],
      },
      include: thresholdInclude,
      orderBy: { minAmount: 'asc' },
    });

    return {
      operation,
      amount: value.toFixed(2),
      requiresApproval: thresholds.length > 0,
      authorizedRoles: thresholds.map((t) => t.requiredRole),
      matchedThresholds: thresholds,
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
    const role = await this.prisma.role.findFirst({
      where: { id: roleId, companyId },
      select: { id: true },
    });
    if (!role) {
      throw new BadRequestException('Perfil informado não pertence a esta empresa.');
    }
  }
}
