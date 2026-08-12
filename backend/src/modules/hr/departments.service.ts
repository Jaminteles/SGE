import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { PaginatedResult } from '../../common/dto/paginated-result';
import { ReferencesService } from '../../common/references/references.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';

/** Departamentos (RF-014) — `gestao.departamento`, hierárquico. */
@Injectable()
export class DepartmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly references: ReferencesService,
  ) {}

  async create(companyId: string, dto: CreateDepartmentDto) {
    await this.references.assert(companyId, {
      departmentId: dto.parentId,
      costCenterId: dto.costCenterId,
    });

    return this.prisma.db.department.create({
      data: {
        companyId,
        code: dto.code,
        name: dto.name,
        parentId: dto.parentId,
        costCenterId: dto.costCenterId,
      },
    });
  }

  async findAll(companyId: string, query: PaginationQueryDto) {
    const where: Prisma.DepartmentWhereInput = {
      companyId,
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.q
        ? {
            OR: [
              { code: { contains: query.q, mode: 'insensitive' } },
              { name: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const data = await this.prisma.db.department.findMany({
      where,
      orderBy: { code: 'asc' },
      skip: query.skip,
      take: query.take,
    });
    const total = await this.prisma.db.department.count({ where });

    return new PaginatedResult(data, total, query.page, query.pageSize);
  }

  async findOne(companyId: string, id: string) {
    const department = await this.prisma.db.department.findFirst({ where: { id, companyId } });
    if (!department) {
      throw new NotFoundException('Departamento não encontrado.');
    }
    return department;
  }

  async update(companyId: string, id: string, dto: UpdateDepartmentDto) {
    await this.findOne(companyId, id);
    if (dto.parentId === id) {
      throw new BadRequestException('Um departamento não pode ser superior de si mesmo.');
    }
    await this.references.assert(companyId, {
      departmentId: dto.parentId,
      costCenterId: dto.costCenterId,
    });

    // Ciclos indiretos (A → B → A) são recusados pelo banco (bd/06).
    return this.prisma.db.department.update({
      where: { id },
      data: {
        ...(dto.code !== undefined ? { code: dto.code } : {}),
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.parentId !== undefined ? { parentId: dto.parentId } : {}),
        ...(dto.costCenterId !== undefined ? { costCenterId: dto.costCenterId } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }

  /** Inativa: departamento com histórico não é removido (RN-009). */
  async remove(companyId: string, id: string) {
    await this.findOne(companyId, id);
    return this.prisma.db.department.update({ where: { id }, data: { isActive: false } });
  }
}
