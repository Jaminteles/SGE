import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { PaginatedResult } from '../../common/dto/paginated-result';
import { CreateMembershipDto } from './dto/create-membership.dto';
import { UpdateMembershipDto } from './dto/update-membership.dto';

const membershipInclude = {
  user: { select: { id: true, name: true, email: true, status: true } },
  role: { select: { id: true, name: true } },
} satisfies Prisma.MembershipInclude;

@Injectable()
export class MembershipsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Associa um usuário à empresa com um perfil (RF-004). */
  async create(companyId: string, dto: CreateMembershipDto) {
    await this.ensureUserExists(dto.userId);
    await this.ensureRoleBelongsToCompany(companyId, dto.roleId);

    return this.prisma.membership.create({
      data: {
        companyId,
        userId: dto.userId,
        roleId: dto.roleId,
        ...(dto.status ? { status: dto.status } : {}),
      },
      include: membershipInclude,
    });
  }

  async findAll(companyId: string, query: PaginationQueryDto) {
    const where: Prisma.MembershipWhereInput = {
      companyId,
      ...(query.status ? { status: query.status } : {}),
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

    const [data, total] = await this.prisma.$transaction([
      this.prisma.membership.findMany({
        where,
        include: membershipInclude,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.membership.count({ where }),
    ]);

    return new PaginatedResult(data, total, query.page, query.pageSize);
  }

  async findOne(companyId: string, id: string) {
    const membership = await this.prisma.membership.findFirst({
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
      await this.ensureRoleBelongsToCompany(companyId, dto.roleId);
    }
    return this.prisma.membership.update({
      where: { id },
      data: {
        ...(dto.roleId !== undefined ? { roleId: dto.roleId } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
      include: membershipInclude,
    });
  }

  async remove(companyId: string, id: string) {
    await this.findOne(companyId, id);
    await this.prisma.membership.delete({ where: { id } });
  }

  private async ensureUserExists(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) {
      throw new BadRequestException('Usuário informado não existe.');
    }
  }

  private async ensureRoleBelongsToCompany(companyId: string, roleId: string) {
    const role = await this.prisma.role.findFirst({
      where: { id: roleId, companyId },
      select: { id: true },
    });
    if (!role) {
      throw new BadRequestException('Perfil informado não pertence a esta empresa.');
    }
  }
}
