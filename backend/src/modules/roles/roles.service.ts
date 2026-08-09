import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { PaginatedResult } from '../../common/dto/paginated-result';
import { PERMISSION_CATALOG } from '../../common/authorization/permission-catalog';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

const roleInclude = {
  permissions: { include: { permission: true } },
} satisfies Prisma.RoleInclude;

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Catálogo global de permissões disponíveis (RF-011). */
  listPermissionCatalog() {
    return PERMISSION_CATALOG.map(({ code, module, resource, action, description }) => ({
      code,
      module,
      resource,
      action,
      description,
    }));
  }

  async create(companyId: string, dto: CreateRoleDto) {
    const permissionIds = await this.resolvePermissionIds(dto.permissions);
    const role = await this.prisma.role.create({
      data: {
        companyId,
        name: dto.name,
        description: dto.description,
        permissions: { create: permissionIds.map((permissionId) => ({ permissionId })) },
      },
      include: roleInclude,
    });
    return this.toResponse(role);
  }

  async findAll(companyId: string, query: PaginationQueryDto) {
    const where: Prisma.RoleWhereInput = {
      companyId,
      ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.role.findMany({
        where,
        include: roleInclude,
        orderBy: { name: 'asc' },
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.role.count({ where }),
    ]);

    return new PaginatedResult(
      rows.map((r) => this.toResponse(r)),
      total,
      query.page,
      query.pageSize,
    );
  }

  async findOne(companyId: string, id: string) {
    const role = await this.loadRole(companyId, id);
    return this.toResponse(role);
  }

  /** Perfis do sistema (ex.: Administrador) são imutáveis para preservar acesso. */
  async update(companyId: string, id: string, dto: UpdateRoleDto) {
    const role = await this.loadRole(companyId, id);
    if (role.isSystem) {
      throw new ForbiddenException('Perfis do sistema não podem ser alterados.');
    }

    const data: Prisma.RoleUpdateInput = {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
    };

    if (dto.permissions !== undefined) {
      const permissionIds = await this.resolvePermissionIds(dto.permissions);
      // Substitui o conjunto de permissões de forma atômica.
      data.permissions = {
        deleteMany: {},
        create: permissionIds.map((permissionId) => ({ permissionId })),
      };
    }

    const updated = await this.prisma.role.update({
      where: { id },
      data,
      include: roleInclude,
    });
    return this.toResponse(updated);
  }

  async remove(companyId: string, id: string) {
    const role = await this.loadRole(companyId, id);
    if (role.isSystem) {
      throw new ForbiddenException('Perfis do sistema não podem ser removidos.');
    }

    const inUse = await this.prisma.membership.count({ where: { roleId: id } });
    if (inUse > 0) {
      throw new ConflictException('Perfil vinculado a usuários. Reatribua-os antes de remover.');
    }

    await this.prisma.role.delete({ where: { id } });
  }

  private async loadRole(companyId: string, id: string) {
    const role = await this.prisma.role.findFirst({
      where: { id, companyId },
      include: roleInclude,
    });
    if (!role) {
      throw new NotFoundException('Perfil não encontrado.');
    }
    return role;
  }

  private async resolvePermissionIds(codes: string[]): Promise<string[]> {
    if (codes.length === 0) {
      return [];
    }
    const permissions = await this.prisma.permission.findMany({
      where: { code: { in: codes } },
      select: { id: true, code: true },
    });
    const found = new Set(permissions.map((p) => p.code));
    const unknown = codes.filter((c) => !found.has(c));
    if (unknown.length > 0) {
      throw new BadRequestException(`Permissões inexistentes: ${unknown.join(', ')}.`);
    }
    return permissions.map((p) => p.id);
  }

  private toResponse(role: Prisma.RoleGetPayload<{ include: typeof roleInclude }>) {
    return {
      id: role.id,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      permissions: role.permissions.map((rp) => rp.permission.code),
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    };
  }
}
