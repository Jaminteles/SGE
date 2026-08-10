import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, TxClient } from '../../prisma/prisma.service';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { PaginatedResult } from '../../common/dto/paginated-result';
import { AddressDto } from '../../common/dto/address.dto';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';

const branchInclude = {
  addresses: { where: { isPrimary: true }, take: 1 },
} satisfies Prisma.BranchInclude;

@Injectable()
export class BranchesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(companyId: string, dto: CreateBranchDto) {
    return this.prisma.transaction(async (tx) => {
      const branch = await tx.branch.create({
        data: {
          companyId,
          code: dto.code,
          name: dto.name,
          taxId: dto.taxId,
          stateRegistration: dto.stateRegistration,
          municipalRegistration: dto.municipalRegistration,
          isHeadquarters: dto.isHeadquarters ?? false,
        },
      });
      await this.upsertPrimaryAddress(tx, companyId, branch.id, dto);
      return tx.branch.findUniqueOrThrow({ where: { id: branch.id }, include: branchInclude });
    });
  }

  async findAll(companyId: string, query: PaginationQueryDto) {
    const where: Prisma.BranchWhereInput = {
      companyId, // isolamento por empresa (RF-005), reforçado pela RLS
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { code: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const data = await this.prisma.db.branch.findMany({
      where,
      orderBy: { code: 'asc' },
      skip: query.skip,
      take: query.take,
    });
    const total = await this.prisma.db.branch.count({ where });

    return new PaginatedResult(data, total, query.page, query.pageSize);
  }

  async findOne(companyId: string, id: string) {
    const branch = await this.prisma.db.branch.findFirst({
      where: { id, companyId },
      include: branchInclude,
    });
    if (!branch) {
      throw new NotFoundException('Filial não encontrada.');
    }
    return branch;
  }

  async update(companyId: string, id: string, dto: UpdateBranchDto) {
    await this.findOne(companyId, id);
    return this.prisma.transaction(async (tx) => {
      await tx.branch.update({
        where: { id },
        data: {
          ...(dto.code !== undefined ? { code: dto.code } : {}),
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.taxId !== undefined ? { taxId: dto.taxId } : {}),
          ...(dto.stateRegistration !== undefined
            ? { stateRegistration: dto.stateRegistration }
            : {}),
          ...(dto.municipalRegistration !== undefined
            ? { municipalRegistration: dto.municipalRegistration }
            : {}),
          ...(dto.isHeadquarters !== undefined ? { isHeadquarters: dto.isHeadquarters } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      });
      await this.upsertPrimaryAddress(tx, companyId, id, dto);
      return tx.branch.findUniqueOrThrow({ where: { id }, include: branchInclude });
    });
  }

  /** Inativa a filial (soft delete, reversível) — RF-002. */
  async remove(companyId: string, id: string) {
    await this.findOne(companyId, id);
    return this.prisma.db.branch.update({ where: { id }, data: { isActive: false } });
  }

  /** Endereço principal da filial: linha de `gestao.endereco` com filial_id. */
  private async upsertPrimaryAddress(
    tx: TxClient,
    companyId: string,
    branchId: string,
    dto: AddressDto,
  ) {
    const informed = [dto.addressStreet, dto.addressCity, dto.addressState].some(
      (v) => v !== undefined,
    );
    if (!informed) {
      return;
    }

    const current = await tx.address.findFirst({ where: { branchId, isPrimary: true } });
    const street = dto.addressStreet ?? current?.street;
    const city = dto.addressCity ?? current?.city;
    const state = dto.addressState ?? current?.state;
    if (!street || !city || !state) {
      throw new BadRequestException(
        'Endereço incompleto: addressStreet, addressCity e addressState são obrigatórios.',
      );
    }

    const data = {
      street,
      city,
      state,
      number: dto.addressNumber,
      complement: dto.addressComplement,
      district: dto.addressDistrict,
      zipCode: dto.addressZipCode,
      ...(dto.addressCountry ? { country: dto.addressCountry } : {}),
    };

    if (current) {
      await tx.address.update({ where: { id: current.id }, data });
      return;
    }

    await tx.address.create({
      data: { ...data, companyId, branchId, type: 'PRINCIPAL', isPrimary: true },
    });
  }
}
