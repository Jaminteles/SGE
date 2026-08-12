import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateBankAccountDto } from '../../common/banking/dto/create-bank-account.dto';
import { UpdateBankAccountDto } from '../../common/banking/dto/update-bank-account.dto';
import {
  assertPayableAccount,
  toBankAccountColumns,
} from '../../common/banking/bank-account.mapper';
import { PartnersService } from './partners.service';

/**
 * Dados bancários do parceiro (RF-024) — `gestao.dado_bancario`.
 *
 * Mesma tabela e mesmo contrato do dado bancário de funcionário, com permissão
 * própria: é a conta para onde o pagamento ao fornecedor será enviado, o alvo
 * clássico da fraude de troca de conta.
 */
@Injectable()
export class PartnerBankAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly partners: PartnersService,
  ) {}

  async create(companyId: string, partnerId: string, dto: CreateBankAccountDto) {
    await this.partners.findOne(companyId, partnerId);
    assertPayableAccount(dto);

    return this.prisma.transaction(async () => {
      if (dto.isPrimary) {
        await this.clearPrimary(companyId, partnerId);
      }
      return this.prisma.db.bankAccount.create({
        data: {
          companyId,
          partnerId,
          ...toBankAccountColumns(dto),
          isPrimary: dto.isPrimary ?? false,
        },
      });
    });
  }

  async findAll(companyId: string, partnerId: string) {
    await this.partners.findOne(companyId, partnerId);
    return this.prisma.db.bankAccount.findMany({
      where: { companyId, partnerId },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async update(companyId: string, partnerId: string, id: string, dto: UpdateBankAccountDto) {
    const current = await this.load(companyId, partnerId, id);
    assertPayableAccount({ ...current, ...dto } as CreateBankAccountDto);

    return this.prisma.transaction(async () => {
      if (dto.isPrimary) {
        await this.clearPrimary(companyId, partnerId);
      }
      return this.prisma.db.bankAccount.update({
        where: { id: current.id },
        data: {
          ...toBankAccountColumns(dto),
          ...(dto.isPrimary !== undefined ? { isPrimary: dto.isPrimary } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      });
    });
  }

  /** Inativa: a conta que já recebeu pagamento precisa continuar rastreável. */
  async remove(companyId: string, partnerId: string, id: string) {
    const current = await this.load(companyId, partnerId, id);
    return this.prisma.db.bankAccount.update({
      where: { id: current.id },
      data: { isActive: false, isPrimary: false },
    });
  }

  private async load(companyId: string, partnerId: string, id: string) {
    const account = await this.prisma.db.bankAccount.findFirst({
      where: { id, companyId, partnerId },
    });
    if (!account) {
      throw new NotFoundException('Dado bancário não encontrado.');
    }
    return account;
  }

  /** Só existe uma conta padrão por parceiro. */
  private async clearPrimary(companyId: string, partnerId: string) {
    await this.prisma.db.bankAccount.updateMany({
      where: { companyId, partnerId, isPrimary: true },
      data: { isPrimary: false },
    });
  }
}
