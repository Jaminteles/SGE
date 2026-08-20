import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ReferencesService } from '../../common/references/references.service';
import { PaginatedResult } from '../../common/dto/paginated-result';
import { CreateCompanyAccountDto } from './dto/create-company-account.dto';
import { UpdateCompanyAccountDto } from './dto/update-company-account.dto';
import { QueryCompanyAccountDto } from './dto/query-company-account.dto';

const LIST_FIELDS = {
  id: true,
  description: true,
  bankCode: true,
  bankName: true,
  agency: true,
  agencyDigit: true,
  account: true,
  accountDigit: true,
  accountType: true,
  pixKey: true,
  branchId: true,
  providerId: true,
  credentialId: true,
  openingBalance: true,
  currentBalance: true,
  balanceDate: true,
  allowsPayment: true,
  allowsReceipt: true,
  isDefault: true,
  isActive: true,
  note: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * Contas bancárias da empresa (RF-059) — `gestao.conta_bancaria`.
 *
 * Duas regras que o banco também aplica e que aqui viram mensagem de domínio
 * (bd/13 §3): a empresa tem no máximo uma conta padrão, e conta que paga precisa
 * ter para onde debitar. Repetir a validação evita que uma violação de índice
 * único chegue ao cliente como 409 genérico.
 *
 * Não há remoção: a conta é referenciada por transações, extratos e baixas já
 * lançados. Desativar é o que existe, e o trigger cuida de tirar dela o papel de
 * padrão e a permissão de movimentar.
 */
@Injectable()
export class CompanyAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly references: ReferencesService,
  ) {}

  async findAll(companyId: string, query: QueryCompanyAccountDto) {
    const where: Prisma.CompanyBankAccountWhereInput = {
      companyId,
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...(query.allowsPayment !== undefined ? { allowsPayment: query.allowsPayment } : {}),
      ...(query.allowsReceipt !== undefined ? { allowsReceipt: query.allowsReceipt } : {}),
      ...(query.q
        ? {
            OR: [
              { description: { contains: query.q, mode: 'insensitive' } },
              { bankName: { contains: query.q, mode: 'insensitive' } },
              { account: { contains: query.q } },
            ],
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.db.companyBankAccount.findMany({
        where,
        orderBy: [{ isDefault: 'desc' }, { description: 'asc' }],
        skip: query.skip,
        take: query.take,
        select: LIST_FIELDS,
      }),
      this.prisma.db.companyBankAccount.count({ where }),
    ]);

    return new PaginatedResult(data, total, query.page, query.pageSize);
  }

  async findOne(companyId: string, id: string) {
    const account = await this.prisma.db.companyBankAccount.findFirst({
      where: { id, companyId },
      select: LIST_FIELDS,
    });
    if (!account) {
      throw new NotFoundException('Conta bancária não encontrada.');
    }
    return account;
  }

  /** Versão interna: traz o que o motor de pagamento precisa, sem paginar. */
  async findForPayment(companyId: string, id: string) {
    const account = await this.prisma.db.companyBankAccount.findFirst({
      where: { id, companyId },
      select: {
        id: true,
        bankCode: true,
        agency: true,
        account: true,
        accountDigit: true,
        pixKey: true,
        providerId: true,
        credentialId: true,
        isActive: true,
        allowsPayment: true,
        allowsReceipt: true,
      },
    });
    if (!account) {
      throw new NotFoundException('Conta bancária não encontrada.');
    }
    if (!account.isActive) {
      throw new ConflictException('A conta bancária está inativa.');
    }
    return account;
  }

  async create(companyId: string, dto: CreateCompanyAccountDto) {
    await this.assertReferences(companyId, dto);
    this.assertPayable(dto.allowsPayment ?? true, dto.agency, dto.pixKey);

    return this.prisma.transaction(async () => {
      if (dto.isDefault) {
        await this.clearDefault(companyId);
      }
      return this.prisma.db.companyBankAccount.create({
        data: {
          companyId,
          branchId: dto.branchId,
          providerId: dto.providerId,
          credentialId: dto.credentialId,
          description: dto.description,
          bankCode: dto.bankCode,
          bankName: dto.bankName,
          agency: dto.agency,
          agencyDigit: dto.agencyDigit,
          account: dto.account,
          accountDigit: dto.accountDigit,
          accountType: dto.accountType,
          pixKey: dto.pixKey,
          openingBalance: dto.openingBalance ? new Prisma.Decimal(dto.openingBalance) : undefined,
          allowsPayment: dto.allowsPayment,
          allowsReceipt: dto.allowsReceipt,
          isDefault: dto.isDefault,
          note: dto.note,
        },
        select: LIST_FIELDS,
      });
    });
  }

  async update(companyId: string, id: string, dto: UpdateCompanyAccountDto) {
    const current = await this.findOne(companyId, id);
    await this.assertReferences(companyId, dto);
    this.assertPayable(
      dto.allowsPayment ?? current.allowsPayment,
      current.agency,
      dto.pixKey ?? current.pixKey,
    );

    return this.prisma.transaction(async () => {
      if (dto.isDefault) {
        await this.clearDefault(companyId, id);
      }
      return this.prisma.db.companyBankAccount.update({
        where: { id },
        data: {
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.bankName !== undefined ? { bankName: dto.bankName } : {}),
          ...(dto.agencyDigit !== undefined ? { agencyDigit: dto.agencyDigit } : {}),
          ...(dto.accountDigit !== undefined ? { accountDigit: dto.accountDigit } : {}),
          ...(dto.accountType !== undefined ? { accountType: dto.accountType } : {}),
          ...(dto.pixKey !== undefined ? { pixKey: dto.pixKey } : {}),
          ...(dto.branchId !== undefined ? { branchId: dto.branchId } : {}),
          ...(dto.providerId !== undefined ? { providerId: dto.providerId } : {}),
          ...(dto.credentialId !== undefined ? { credentialId: dto.credentialId } : {}),
          ...(dto.allowsPayment !== undefined ? { allowsPayment: dto.allowsPayment } : {}),
          ...(dto.allowsReceipt !== undefined ? { allowsReceipt: dto.allowsReceipt } : {}),
          ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          ...(dto.note !== undefined ? { note: dto.note } : {}),
        },
        select: LIST_FIELDS,
      });
    });
  }

  /**
   * Referências dentro da empresa (RF-005). `credentialId` não está no
   * `ReferencesService` porque é cadastro deste módulo — a consulta filtra por
   * empresa do mesmo jeito.
   */
  private async assertReferences(
    companyId: string,
    dto: { branchId?: string; providerId?: string; credentialId?: string },
  ): Promise<void> {
    await this.references.assert(companyId, { branchId: dto.branchId });

    if (dto.providerId) {
      const provider = await this.prisma.db.provider.findFirst({
        where: { id: dto.providerId, isActive: true },
        select: { id: true },
      });
      if (!provider) {
        throw new BadRequestException('Provedor inválido ou inativo.');
      }
    }

    if (dto.credentialId) {
      const credential = await this.prisma.db.integrationCredential.findFirst({
        where: { id: dto.credentialId, companyId, isActive: true },
        select: { providerId: true },
      });
      if (!credential) {
        throw new BadRequestException('Credencial de integração inválida para esta empresa.');
      }
      if (dto.providerId && credential.providerId !== dto.providerId) {
        throw new BadRequestException('A credencial informada é de outro provedor.');
      }
    }
  }

  /** Sem agência e sem chave PIX, a conta não credita nada (bd/13 §3). */
  private assertPayable(
    allowsPayment: boolean,
    agency: string | null | undefined,
    pixKey: string | null | undefined,
  ): void {
    if (allowsPayment && !agency && !pixKey) {
      throw new BadRequestException(
        'Uma conta habilitada a pagar precisa de agência e conta ou de chave PIX.',
      );
    }
  }

  /** Só uma conta padrão por empresa (`ux_conta_bancaria_padrao`). */
  private async clearDefault(companyId: string, exceptId?: string): Promise<void> {
    await this.prisma.db.companyBankAccount.updateMany({
      where: { companyId, isDefault: true, ...(exceptId ? { id: { not: exceptId } } : {}) },
      data: { isDefault: false },
    });
  }
}
