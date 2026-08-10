import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, TxClient } from '../../prisma/prisma.service';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { PaginatedResult } from '../../common/dto/paginated-result';
import { AddressDto } from '../../common/dto/address.dto';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';

/** Nome do perfil administrador criado no provisionamento da empresa (RF-010). */
export const DEFAULT_ADMIN_ROLE_NAME = 'Administrador';

/** Empresa + endereço principal (gestao.endereco com empresa_ref_id). */
const companyInclude = {
  addresses: { where: { isPrimary: true }, take: 1 },
} satisfies Prisma.CompanyInclude;

@Injectable()
export class CompaniesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cadastra a empresa e provisiona o perfil administrador com todas as
   * permissões (RF-001 + RF-010). Transacional para não deixar empresa sem
   * perfil administrativo (RNF-006/007).
   *
   * As linhas de `perfil` e `endereco` só passam pela RLS com `app.empresa_id`
   * apontando para a empresa recém-criada — daí o `withCompany`.
   */
  async create(dto: CreateCompanyDto) {
    return this.prisma.transaction(async (tx) => {
      const company = await tx.company.create({ data: this.toData(dto) });

      return this.prisma.withCompany(company.id, async () => {
        const permissions = await tx.permission.findMany({
          where: { module: { in: ['M01', 'M02'] } },
          select: { id: true },
        });

        await tx.role.create({
          data: {
            companyId: company.id,
            name: DEFAULT_ADMIN_ROLE_NAME,
            description: 'Acesso total à empresa',
            isSystem: true,
            permissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
          },
        });

        await this.upsertPrimaryAddress(tx, company.id, dto);

        return tx.company.findUniqueOrThrow({
          where: { id: company.id },
          include: companyInclude,
        });
      });
    });
  }

  async findAll(query: PaginationQueryDto) {
    const where: Prisma.CompanyWhereInput = {
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.q
        ? {
            OR: [
              { legalName: { contains: query.q, mode: 'insensitive' } },
              { tradeName: { contains: query.q, mode: 'insensitive' } },
              { taxId: { contains: query.q.replace(/\D/g, '') } },
            ],
          }
        : {}),
    };

    const data = await this.prisma.db.company.findMany({
      where,
      orderBy: { legalName: 'asc' },
      skip: query.skip,
      take: query.take,
    });
    const total = await this.prisma.db.company.count({ where });

    return new PaginatedResult(data, total, query.page, query.pageSize);
  }

  async findOne(id: string) {
    const company = await this.prisma.db.company.findUnique({
      where: { id },
      include: companyInclude,
    });
    if (!company) {
      throw new NotFoundException('Empresa não encontrada.');
    }
    return company;
  }

  async update(id: string, dto: UpdateCompanyDto) {
    await this.findOne(id);
    return this.prisma.withCompany(id, async () => {
      await this.prisma.db.company.update({ where: { id }, data: this.toData(dto) });
      await this.upsertPrimaryAddress(this.prisma.db, id, dto);
      return this.prisma.db.company.findUniqueOrThrow({ where: { id }, include: companyInclude });
    });
  }

  /** Ativa/inativa a empresa (RF-001). */
  async setActive(id: string, isActive: boolean) {
    await this.findOne(id);
    return this.prisma.db.company.update({
      where: { id },
      data: { isActive },
      include: companyInclude,
    });
  }

  private toData(dto: CreateCompanyDto | UpdateCompanyDto): Prisma.CompanyUncheckedCreateInput {
    // Repassa apenas os campos definidos; o Prisma ignora `undefined`.
    return {
      legalName: dto.legalName as string,
      tradeName: dto.tradeName,
      taxId: (dto as CreateCompanyDto).taxId,
      stateRegistration: dto.stateRegistration,
      municipalRegistration: dto.municipalRegistration,
      taxRegime: dto.taxRegime,
      mainCnae: dto.mainCnae,
      email: dto.email,
      phone: dto.phone,
    };
  }

  /**
   * Endereço principal da empresa (RF-003). No banco é uma linha de
   * `gestao.endereco` com `empresa_ref_id` — logradouro, cidade e UF são
   * obrigatórios, então o endereço é informado por inteiro ou não é informado.
   */
  private async upsertPrimaryAddress(tx: TxClient, companyId: string, dto: AddressDto) {
    const informed = [dto.addressStreet, dto.addressCity, dto.addressState].some(
      (v) => v !== undefined,
    );
    if (!informed) {
      return;
    }

    const current = await tx.address.findFirst({
      where: { ownerCompanyId: companyId, isPrimary: true },
    });

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
      data: {
        ...data,
        companyId,
        ownerCompanyId: companyId,
        type: 'PRINCIPAL',
        isPrimary: true,
      },
    });
  }
}
