import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PersonType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/paginated-result';
import { ReferencesService } from '../../common/references/references.service';
import { CreatePartnerDto } from './dto/create-partner.dto';
import { UpdatePartnerDto } from './dto/update-partner.dto';
import { CustomerProfileDto } from './dto/customer-profile.dto';
import { SupplierProfileDto } from './dto/supplier-profile.dto';
import { PartnerRole, QueryPartnerDto } from './dto/query-partner.dto';

const partnerInclude = {
  customer: true,
  supplier: true,
} satisfies Prisma.PartnerInclude;

/**
 * Clientes e fornecedores (RF-022 a RF-024, RF-026) — `gestao.parceiro`.
 *
 * Papel e perfil andam juntos: habilitar `isCustomer`/`isSupplier` cria (ou
 * reaproveita) a linha de `cliente`/`fornecedor`. Desabilitar **não apaga** o
 * perfil — limite de crédito, condição negociada e motivo de bloqueio são
 * histórico comercial, e reativar o papel devolve o que já estava acordado.
 */
@Injectable()
export class PartnersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly references: ReferencesService,
  ) {}

  async create(companyId: string, dto: CreatePartnerDto) {
    const isCustomer = dto.isCustomer ?? false;
    const isSupplier = dto.isSupplier ?? false;
    this.assertRoles(isCustomer, isSupplier);
    this.assertDocument(dto.personType, dto);
    await this.assertProfileReferences(companyId, dto.customer, dto.supplier);

    return this.prisma.transaction(async () => {
      const partner = await this.prisma.db.partner.create({
        data: {
          companyId,
          personType: dto.personType,
          code: dto.code,
          legalName: dto.legalName,
          tradeName: dto.tradeName,
          cnpj: dto.cnpj,
          cpf: dto.cpf,
          foreignDocument: dto.foreignDocument,
          stateRegistration: dto.stateRegistration,
          municipalRegistration: dto.municipalRegistration,
          icmsTaxpayer: dto.icmsTaxpayer ?? false,
          taxRegime: dto.taxRegime,
          email: dto.email,
          phone: dto.phone,
          website: dto.website,
          isCustomer,
          isSupplier,
          note: dto.note,
        },
      });

      if (isCustomer) {
        await this.upsertCustomer(companyId, partner.id, dto.customer);
      }
      if (isSupplier) {
        await this.upsertSupplier(companyId, partner.id, dto.supplier);
      }

      return this.findOne(companyId, partner.id);
    });
  }

  async findAll(companyId: string, query: QueryPartnerDto) {
    // Busca textual: razão social, nome fantasia, código e — quando o termo é
    // numérico — o começo do CNPJ/CPF.
    const documentTerm = (query.q ?? '').replace(/\D/g, '');
    const where: Prisma.PartnerWhereInput = {
      companyId,
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.personType ? { personType: query.personType } : {}),
      ...(query.role === PartnerRole.CLIENTE ? { isCustomer: true } : {}),
      ...(query.role === PartnerRole.FORNECEDOR ? { isSupplier: true } : {}),
      ...(query.q
        ? {
            OR: [
              { legalName: { contains: query.q, mode: 'insensitive' } },
              { tradeName: { contains: query.q, mode: 'insensitive' } },
              { code: { contains: query.q, mode: 'insensitive' } },
              ...(documentTerm.length >= 3
                ? [{ cnpj: { startsWith: documentTerm } }, { cpf: { startsWith: documentTerm } }]
                : []),
            ],
          }
        : {}),
    };

    const data = await this.prisma.db.partner.findMany({
      where,
      include: partnerInclude,
      orderBy: { legalName: 'asc' },
      skip: query.skip,
      take: query.take,
    });
    const total = await this.prisma.db.partner.count({ where });

    return new PaginatedResult(data, total, query.page, query.pageSize);
  }

  async findOne(companyId: string, id: string) {
    const partner = await this.prisma.db.partner.findFirst({
      where: { id, companyId },
      include: partnerInclude,
    });
    if (!partner) {
      throw new NotFoundException('Parceiro não encontrado.');
    }
    return partner;
  }

  async update(companyId: string, id: string, dto: UpdatePartnerDto) {
    const current = await this.findOne(companyId, id);
    const isCustomer = dto.isCustomer ?? current.isCustomer;
    const isSupplier = dto.isSupplier ?? current.isSupplier;
    this.assertRoles(isCustomer, isSupplier);
    this.assertDocument(current.personType, { ...current, ...dto });
    await this.assertProfileReferences(companyId, dto.customer, dto.supplier);

    return this.prisma.transaction(async () => {
      await this.prisma.db.partner.update({
        where: { id: current.id },
        data: {
          ...(dto.code !== undefined ? { code: dto.code } : {}),
          ...(dto.legalName !== undefined ? { legalName: dto.legalName } : {}),
          ...(dto.tradeName !== undefined ? { tradeName: dto.tradeName } : {}),
          ...(dto.cnpj !== undefined ? { cnpj: dto.cnpj } : {}),
          ...(dto.cpf !== undefined ? { cpf: dto.cpf } : {}),
          ...(dto.foreignDocument !== undefined ? { foreignDocument: dto.foreignDocument } : {}),
          ...(dto.stateRegistration !== undefined
            ? { stateRegistration: dto.stateRegistration }
            : {}),
          ...(dto.municipalRegistration !== undefined
            ? { municipalRegistration: dto.municipalRegistration }
            : {}),
          ...(dto.icmsTaxpayer !== undefined ? { icmsTaxpayer: dto.icmsTaxpayer } : {}),
          ...(dto.taxRegime !== undefined ? { taxRegime: dto.taxRegime } : {}),
          ...(dto.email !== undefined ? { email: dto.email } : {}),
          ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
          ...(dto.website !== undefined ? { website: dto.website } : {}),
          ...(dto.note !== undefined ? { note: dto.note } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          isCustomer,
          isSupplier,
        },
      });

      // O papel precisa estar ativo antes de gravar o perfil: bd/07 recusa
      // linha de cliente/fornecedor para quem não exerce o papel.
      if (isCustomer && (dto.customer || dto.isCustomer)) {
        await this.upsertCustomer(companyId, current.id, dto.customer);
      }
      if (isSupplier && (dto.supplier || dto.isSupplier)) {
        await this.upsertSupplier(companyId, current.id, dto.supplier);
      }

      return this.findOne(companyId, current.id);
    });
  }

  /** Inativa: parceiro com títulos e pedidos não é removido (RN-009). */
  async remove(companyId: string, id: string) {
    await this.findOne(companyId, id);
    await this.prisma.db.partner.update({ where: { id }, data: { isActive: false } });
    return this.findOne(companyId, id);
  }

  private assertRoles(isCustomer: boolean, isSupplier: boolean): void {
    if (!isCustomer && !isSupplier) {
      throw new BadRequestException('O parceiro precisa ser cliente, fornecedor ou ambos.');
    }
  }

  /**
   * O documento é o que identifica o parceiro no fisco e é a chave usada para
   * reconhecê-lo em nota, título e conciliação: cada tipo de pessoa exige o
   * seu (o mesmo CHECK existe em bd/01).
   */
  private assertDocument(
    personType: PersonType,
    dto: { cnpj?: string | null; cpf?: string | null; foreignDocument?: string | null },
  ): void {
    const required: Record<PersonType, { field: keyof typeof dto; label: string }> = {
      [PersonType.PJ]: { field: 'cnpj', label: 'CNPJ' },
      [PersonType.PF]: { field: 'cpf', label: 'CPF' },
      [PersonType.ESTRANGEIRO]: { field: 'foreignDocument', label: 'documento estrangeiro' },
    };
    const { field, label } = required[personType];
    if (!dto[field]) {
      throw new BadRequestException(`Parceiro do tipo ${personType} exige ${label}.`);
    }
  }

  private async assertProfileReferences(
    companyId: string,
    customer?: CustomerProfileDto,
    supplier?: SupplierProfileDto,
  ): Promise<void> {
    if (customer) {
      this.assertBlockReason(customer.isBlocked, customer.blockReason);
      await this.references.assert(companyId, {
        paymentTermId: customer.paymentTermId,
        paymentMethodId: customer.paymentMethodId,
        employeeId: customer.salesRepId,
      });
    }
    if (supplier) {
      this.assertBlockReason(supplier.isBlocked, supplier.blockReason);
      await this.references.assert(companyId, {
        paymentTermId: supplier.paymentTermId,
        paymentMethodId: supplier.paymentMethodId,
        categoryId: supplier.defaultCategoryId,
      });
    }
  }

  /** Bloqueio sem motivo registrado não é auditável nem revisável. */
  private assertBlockReason(isBlocked?: boolean, blockReason?: string): void {
    if (isBlocked && !blockReason?.trim()) {
      throw new BadRequestException('Informe o motivo do bloqueio.');
    }
  }

  private async upsertCustomer(companyId: string, partnerId: string, dto?: CustomerProfileDto) {
    const data = {
      ...(dto?.creditLimit !== undefined
        ? { creditLimit: new Prisma.Decimal(dto.creditLimit) }
        : {}),
      ...(dto?.paymentTermId !== undefined ? { paymentTermId: dto.paymentTermId } : {}),
      ...(dto?.paymentMethodId !== undefined ? { paymentMethodId: dto.paymentMethodId } : {}),
      ...(dto?.salesRepId !== undefined ? { salesRepId: dto.salesRepId } : {}),
      ...(dto?.preferredDueDay !== undefined ? { preferredDueDay: dto.preferredDueDay } : {}),
      ...(dto?.isBlocked !== undefined ? { isBlocked: dto.isBlocked } : {}),
      ...(dto?.blockReason !== undefined ? { blockReason: dto.blockReason } : {}),
    };

    await this.prisma.db.customer.upsert({
      where: { partnerId },
      create: { partnerId, companyId, ...data },
      update: data,
    });
  }

  private async upsertSupplier(companyId: string, partnerId: string, dto?: SupplierProfileDto) {
    const data = {
      ...(dto?.paymentTermId !== undefined ? { paymentTermId: dto.paymentTermId } : {}),
      ...(dto?.paymentMethodId !== undefined ? { paymentMethodId: dto.paymentMethodId } : {}),
      ...(dto?.deliveryDays !== undefined ? { deliveryDays: dto.deliveryDays } : {}),
      ...(dto?.defaultCategoryId !== undefined ? { defaultCategoryId: dto.defaultCategoryId } : {}),
      ...(dto?.isApproved !== undefined ? { isApproved: dto.isApproved } : {}),
      ...(dto?.isBlocked !== undefined ? { isBlocked: dto.isBlocked } : {}),
      ...(dto?.blockReason !== undefined ? { blockReason: dto.blockReason } : {}),
    };

    await this.prisma.db.supplier.upsert({
      where: { partnerId },
      create: { partnerId, companyId, ...data },
      update: data,
    });
  }
}
