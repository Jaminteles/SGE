import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateBankAccountDto } from '../../common/banking/dto/create-bank-account.dto';
import { UpdateBankAccountDto } from '../../common/banking/dto/update-bank-account.dto';
import {
  assertPayableAccount,
  toBankAccountColumns,
} from '../../common/banking/bank-account.mapper';
import { EmployeesService } from './employees.service';

/**
 * Dados bancários do funcionário (RF-013) — `gestao.dado_bancario`.
 *
 * Recurso com permissão separada do cadastro funcional: trocar a conta de
 * crédito é o passo final de boa parte das fraudes de folha, e quem mantém
 * nome, cargo e lotação não precisa desse acesso.
 */
@Injectable()
export class BankAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employees: EmployeesService,
  ) {}

  async create(companyId: string, employeeId: string, dto: CreateBankAccountDto) {
    await this.employees.findOne(companyId, employeeId);
    assertPayableAccount(dto);

    return this.prisma.transaction(async () => {
      if (dto.isPrimary) {
        await this.clearPrimary(companyId, employeeId);
      }
      return this.prisma.db.bankAccount.create({
        data: {
          companyId,
          employeeId,
          ...toBankAccountColumns(dto),
          isPrimary: dto.isPrimary ?? false,
        },
      });
    });
  }

  async findAll(companyId: string, employeeId: string) {
    await this.employees.findOne(companyId, employeeId);
    return this.prisma.db.bankAccount.findMany({
      where: { companyId, employeeId },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async update(companyId: string, employeeId: string, id: string, dto: UpdateBankAccountDto) {
    const current = await this.load(companyId, employeeId, id);
    assertPayableAccount({ ...current, ...dto } as CreateBankAccountDto);

    return this.prisma.transaction(async () => {
      if (dto.isPrimary) {
        await this.clearPrimary(companyId, employeeId);
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

  /** Inativa: a conta que já recebeu crédito precisa continuar rastreável. */
  async remove(companyId: string, employeeId: string, id: string) {
    const current = await this.load(companyId, employeeId, id);
    return this.prisma.db.bankAccount.update({
      where: { id: current.id },
      data: { isActive: false, isPrimary: false },
    });
  }

  private async load(companyId: string, employeeId: string, id: string) {
    const account = await this.prisma.db.bankAccount.findFirst({
      where: { id, companyId, employeeId },
    });
    if (!account) {
      throw new NotFoundException('Dado bancário não encontrado.');
    }
    return account;
  }

  /** Só existe uma conta padrão por funcionário. */
  private async clearPrimary(companyId: string, employeeId: string) {
    await this.prisma.db.bankAccount.updateMany({
      where: { companyId, employeeId, isPrimary: true },
      data: { isPrimary: false },
    });
  }
}
