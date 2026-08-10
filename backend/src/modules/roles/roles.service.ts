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
import {
  PERMISSION_BY_CODE,
  PERMISSION_CATALOG,
  permissionCode,
} from '../../common/authorization/permission-catalog';
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
    const role = await this.prisma.db.role.create({
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

  /**
   * Perfis da empresa e perfis globais do sistema (`empresa_id IS NULL`, carga
   * inicial de bd/03), que ficam disponíveis para todas as empresas.
   */
  async findAll(companyId: string, query: PaginationQueryDto) {
    const where: Prisma.RoleWhereInput = {
      OR: [{ companyId }, { companyId: null }],
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
    };

    const rows = await this.prisma.db.role.findMany({
      where,
      include: roleInclude,
      orderBy: { name: 'asc' },
      skip: query.skip,
      take: query.take,
    });
    const total = await this.prisma.db.role.count({ where });

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
    if (role.isSystem || role.companyId === null) {
      throw new ForbiddenException('Perfis do sistema não podem ser alterados.');
    }

    const data: Prisma.RoleUpdateInput = {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
    };

    if (dto.permissions !== undefined) {
      const permissionIds = await this.resolvePermissionIds(dto.permissions);
      // Substitui o conjunto de permissões de forma atômica.
      data.permissions = {
        deleteMany: {},
        create: permissionIds.map((permissionId) => ({ permissionId })),
      };
    }

    const updated = await this.prisma.db.role.update({
      where: { id },
      data,
      include: roleInclude,
    });
    return this.toResponse(updated);
  }

  async remove(companyId: string, id: string) {
    const role = await this.loadRole(companyId, id);
    if (role.isSystem || role.companyId === null) {
      throw new ForbiddenException('Perfis do sistema não podem ser removidos.');
    }

    const inUse = await this.prisma.db.membership.count({ where: { roleId: id } });
    if (inUse > 0) {
      throw new ConflictException('Perfil vinculado a usuários. Reatribua-os antes de remover.');
    }

    await this.prisma.db.role.delete({ where: { id } });
  }

  private async loadRole(companyId: string, id: string) {
    const role = await this.prisma.db.role.findFirst({
      where: { id, OR: [{ companyId }, { companyId: null }] },
      include: roleInclude,
    });
    if (!role) {
      throw new NotFoundException('Perfil não encontrado.');
    }
    return role;
  }

  /**
   * Resolve os códigos `recurso:AÇÃO` para ids de `gestao.permissao`. A tabela
   * não tem coluna de código: a chave é a tripla (modulo, recurso, acao).
   */
  private async resolvePermissionIds(codes: string[]): Promise<string[]> {
    if (codes.length === 0) {
      return [];
    }

    const unknownInCatalog = codes.filter((c) => !PERMISSION_BY_CODE.has(c));
    if (unknownInCatalog.length > 0) {
      throw new BadRequestException(`Permissões inexistentes: ${unknownInCatalog.join(', ')}.`);
    }

    const wanted = codes.map((c) => PERMISSION_BY_CODE.get(c)!);
    const permissions = await this.prisma.db.permission.findMany({
      where: {
        OR: wanted.map((p) => ({ module: p.module, resource: p.resource, action: p.action })),
      },
      select: { id: true, resource: true, action: true },
    });

    const found = new Set(permissions.map((p) => permissionCode(p.resource, p.action)));
    const missing = codes.filter((c) => !found.has(c));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Permissões ausentes no banco: ${missing.join(', ')}. Rode \`npm run db:seed\`.`,
      );
    }
    return permissions.map((p) => p.id);
  }

  private toResponse(role: Prisma.RoleGetPayload<{ include: typeof roleInclude }>) {
    return {
      id: role.id,
      companyId: role.companyId,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      isActive: role.isActive,
      permissions: role.permissions.map((rp) =>
        permissionCode(rp.permission.resource, rp.permission.action),
      ),
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    };
  }
}
