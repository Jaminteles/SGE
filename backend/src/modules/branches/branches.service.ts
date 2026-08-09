import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RecordStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { PaginatedResult } from '../../common/dto/paginated-result';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';

@Injectable()
export class BranchesService {
  constructor(private readonly prisma: PrismaService) {}

  create(companyId: string, dto: CreateBranchDto) {
    return this.prisma.branch.create({
      data: { companyId, code: dto.code, name: dto.name, ...this.toData(dto) },
    });
  }

  async findAll(companyId: string, query: PaginationQueryDto) {
    const where: Prisma.BranchWhereInput = {
      companyId, // isolamento por empresa (RF-005)
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { code: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.branch.findMany({
        where,
        orderBy: { code: 'asc' },
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.branch.count({ where }),
    ]);

    return new PaginatedResult(data, total, query.page, query.pageSize);
  }

  async findOne(companyId: string, id: string) {
    const branch = await this.prisma.branch.findFirst({ where: { id, companyId } });
    if (!branch) {
      throw new NotFoundException('Filial não encontrada.');
    }
    return branch;
  }

  async update(companyId: string, id: string, dto: UpdateBranchDto) {
    await this.findOne(companyId, id);
    return this.prisma.branch.update({
      where: { id },
      data: {
        ...(dto.code !== undefined ? { code: dto.code } : {}),
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...this.toData(dto),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
    });
  }

  /** Inativa a filial (soft delete, reversível) — RF-002. */
  async remove(companyId: string, id: string) {
    await this.findOne(companyId, id);
    return this.prisma.branch.update({
      where: { id },
      data: { status: RecordStatus.INACTIVE },
    });
  }

  private toData(dto: CreateBranchDto | UpdateBranchDto) {
    return {
      taxId: dto.taxId,
      email: dto.email,
      phone: dto.phone,
      addressStreet: dto.addressStreet,
      addressNumber: dto.addressNumber,
      addressComplement: dto.addressComplement,
      addressDistrict: dto.addressDistrict,
      addressCity: dto.addressCity,
      addressState: dto.addressState,
      addressZipCode: dto.addressZipCode,
      addressCountry: dto.addressCountry,
    };
  }
}
