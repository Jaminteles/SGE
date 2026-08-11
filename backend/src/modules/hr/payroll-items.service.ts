import { Injectable, NotFoundException } from '@nestjs/common';
import { PayrollItemType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { PaginatedResult } from '../../common/dto/paginated-result';
import { HrReferencesService } from './hr-references.service';
import { CreatePayrollItemDto } from './dto/create-payroll-item.dto';
import { UpdatePayrollItemDto } from './dto/update-payroll-item.dto';

/** Catálogo de verbas de folha (RF-017/RF-021) — `gestao.verba`. */
@Injectable()
export class PayrollItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly references: HrReferencesService,
  ) {}

  async create(companyId: string, dto: CreatePayrollItemDto) {
    await this.references.assert(companyId, { categoryId: dto.categoryId });

    return this.prisma.db.payrollItem.create({
      data: {
        companyId,
        code: dto.code,
        name: dto.name,
        type: dto.type,
        categoryId: dto.categoryId,
        ledgerAccountId: dto.ledgerAccountId,
        ...(dto.affectsInss !== undefined ? { affectsInss: dto.affectsInss } : {}),
        ...(dto.affectsIrrf !== undefined ? { affectsIrrf: dto.affectsIrrf } : {}),
        ...(dto.affectsFgts !== undefined ? { affectsFgts: dto.affectsFgts } : {}),
      },
    });
  }

  async findAll(companyId: string, query: PaginationQueryDto, type?: PayrollItemType) {
    const where: Prisma.PayrollItemWhereInput = {
      companyId,
      ...(type ? { type } : {}),
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

    const data = await this.prisma.db.payrollItem.findMany({
      where,
      orderBy: [{ type: 'asc' }, { code: 'asc' }],
      skip: query.skip,
      take: query.take,
    });
    const total = await this.prisma.db.payrollItem.count({ where });

    return new PaginatedResult(data, total, query.page, query.pageSize);
  }

  async findOne(companyId: string, id: string) {
    const item = await this.prisma.db.payrollItem.findFirst({ where: { id, companyId } });
    if (!item) {
      throw new NotFoundException('Verba não encontrada.');
    }
    return item;
  }

  async update(companyId: string, id: string, dto: UpdatePayrollItemDto) {
    await this.findOne(companyId, id);
    await this.references.assert(companyId, { categoryId: dto.categoryId });

    return this.prisma.db.payrollItem.update({
      where: { id },
      data: {
        ...(dto.code !== undefined ? { code: dto.code } : {}),
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
        ...(dto.ledgerAccountId !== undefined ? { ledgerAccountId: dto.ledgerAccountId } : {}),
        ...(dto.affectsInss !== undefined ? { affectsInss: dto.affectsInss } : {}),
        ...(dto.affectsIrrf !== undefined ? { affectsIrrf: dto.affectsIrrf } : {}),
        ...(dto.affectsFgts !== undefined ? { affectsFgts: dto.affectsFgts } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }

  /** Inativa: verba já usada em folha permanece para a consulta histórica. */
  async remove(companyId: string, id: string) {
    await this.findOne(companyId, id);
    return this.prisma.db.payrollItem.update({ where: { id }, data: { isActive: false } });
  }
}
