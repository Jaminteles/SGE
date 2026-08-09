import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RecordStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { PaginatedResult } from '../../common/dto/paginated-result';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';

/** Nome do perfil administrador criado no provisionamento da empresa (RF-010). */
export const DEFAULT_ADMIN_ROLE_NAME = 'Administrador';

@Injectable()
export class CompaniesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cadastra a empresa e provisiona o perfil administrador com todas as
   * permissões (RF-001 + RF-010). Transacional para não deixar empresa sem
   * perfil administrativo (RNF-006/007).
   */
  async create(dto: CreateCompanyDto) {
    return this.prisma.$transaction(async (tx) => {
      const company = await tx.company.create({ data: this.toData(dto) });

      const permissions = await tx.permission.findMany({ select: { id: true } });
      await tx.role.create({
        data: {
          companyId: company.id,
          name: DEFAULT_ADMIN_ROLE_NAME,
          description: 'Acesso total à empresa',
          isSystem: true,
          permissions: {
            create: permissions.map((p) => ({ permissionId: p.id })),
          },
        },
      });

      return company;
    });
  }

  async findAll(query: PaginationQueryDto) {
    const where: Prisma.CompanyWhereInput = {
      ...(query.status ? { status: query.status } : {}),
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

    const [data, total] = await this.prisma.$transaction([
      this.prisma.company.findMany({
        where,
        orderBy: { legalName: 'asc' },
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.company.count({ where }),
    ]);

    return new PaginatedResult(data, total, query.page, query.pageSize);
  }

  async findOne(id: string) {
    const company = await this.prisma.company.findUnique({ where: { id } });
    if (!company) {
      throw new NotFoundException('Empresa não encontrada.');
    }
    return company;
  }

  async update(id: string, dto: UpdateCompanyDto) {
    await this.findOne(id);
    return this.prisma.company.update({ where: { id }, data: this.toData(dto) });
  }

  /** Ativa/inativa a empresa (RF-001). */
  async setStatus(id: string, status: RecordStatus) {
    await this.findOne(id);
    return this.prisma.company.update({ where: { id }, data: { status } });
  }

  private toData(dto: CreateCompanyDto | UpdateCompanyDto): Prisma.CompanyUncheckedCreateInput {
    // Repassa apenas os campos definidos; o Prisma ignora `undefined`.
    return {
      legalName: dto.legalName as string,
      tradeName: dto.tradeName,
      taxId: (dto as CreateCompanyDto).taxId,
      stateRegistration: dto.stateRegistration,
      municipalRegistration: dto.municipalRegistration,
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
