import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { PaginatedResult } from '../../common/dto/paginated-result';
import { CreateMembershipDto } from './dto/create-membership.dto';
import { UpdateMembershipDto } from './dto/update-membership.dto';

const membershipInclude = {
  user: { select: { id: true, name: true, email: true, isActive: true } },
  role: { select: { id: true, name: true } },
  branch: { select: { id: true, code: true, name: true } },
} satisfies Prisma.MembershipInclude;

@Injectable()
export class MembershipsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Associa um usuário à empresa com um perfil (RF-004). O banco permite mais
   * de uma associação por empresa (uma por filial); aqui bloqueamos a
   * duplicidade exata de usuário + filial.
   */
  async create(companyId: string, dto: CreateMembershipDto) {
    await this.ensureUserExists(dto.userId);
    await this.ensureRoleAvailable(companyId, dto.roleId);
    if (dto.branchId) {
      await this.ensureBranch(companyId, dto.branchId);
    }

    const duplicate = await this.prisma.db.membership.findFirst({
      where: { companyId, userId: dto.userId, branchId: dto.branchId ?? null },
    });
    if (duplicate) {
      throw new ConflictException('Usuário já associado a esta empresa/filial.');
    }

    return this.prisma.db.membership.create({
      data: {
        companyId,
        userId: dto.userId,
        roleId: dto.roleId,
        branchId: dto.branchId,
        ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
      include: membershipInclude,
    });
  }

  async findAll(companyId: string, query: PaginationQueryDto) {
    const where: Prisma.MembershipWhereInput = {
      companyId,
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.q
        ? {
            user: {
              OR: [
                { name: { contains: query.q, mode: 'insensitive' } },
                { email: { contains: query.q, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
    };

    const data = await this.prisma.db.membership.findMany({
      where,
      include: membershipInclude,
      orderBy: { createdAt: 'desc' },
      skip: query.skip,
      take: query.take,
    });
    const total = await this.prisma.db.membership.count({ where });

    return new PaginatedResult(data, total, query.page, query.pageSize);
  }

  async findOne(companyId: string, id: string) {
    const membership = await this.prisma.db.membership.findFirst({
      where: { id, companyId },
      include: membershipInclude,
    });
    if (!membership) {
      throw new NotFoundException('Associação não encontrada.');
    }
    return membership;
  }

  async update(companyId: string, id: string, dto: UpdateMembershipDto) {
    await this.findOne(companyId, id);
    if (dto.roleId) {
      await this.ensureRoleAvailable(companyId, dto.roleId);
    }
    if (dto.branchId) {
      await this.ensureBranch(companyId, dto.branchId);
    }
    return this.prisma.db.membership.update({
      where: { id },
      data: {
        ...(dto.roleId !== undefined ? { roleId: dto.roleId } : {}),
        ...(dto.branchId !== undefined ? { branchId: dto.branchId } : {}),
        ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
      include: membershipInclude,
    });
  }

  async remove(companyId: string, id: string) {
    await this.findOne(companyId, id);
    await this.prisma.db.membership.delete({ where: { id } });
  }

  private async ensureUserExists(userId: string) {
    const user = await this.prisma.db.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) {
      throw new BadRequestException('Usuário informado não existe.');
    }
  }

  /** Perfis da empresa ou perfis globais do sistema (empresa_id nulo). */
  private async ensureRoleAvailable(companyId: string, roleId: string) {
    const role = await this.prisma.db.role.findFirst({
      where: { id: roleId, OR: [{ companyId }, { companyId: null }] },
      select: { id: true },
    });
    if (!role) {
      throw new BadRequestException('Perfil informado não pertence a esta empresa.');
    }
  }

  private async ensureBranch(companyId: string, branchId: string) {
    const branch = await this.prisma.db.branch.findFirst({
      where: { id: branchId, companyId },
      select: { id: true },
    });
    if (!branch) {
      throw new BadRequestException('Filial informada não pertence a esta empresa.');
    }
  }
}
