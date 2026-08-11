import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmployeesService } from './employees.service';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import { UpdateBankAccountDto } from './dto/update-bank-account.dto';

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
    this.assertPayable(dto);

    return this.prisma.transaction(async () => {
      if (dto.isPrimary) {
        await this.clearPrimary(companyId, employeeId);
      }
      return this.prisma.db.employeeBankAccount.create({
        data: { companyId, employeeId, ...this.toColumns(dto), isPrimary: dto.isPrimary ?? false },
      });
    });
  }

  async findAll(companyId: string, employeeId: string) {
    await this.employees.findOne(companyId, employeeId);
    return this.prisma.db.employeeBankAccount.findMany({
      where: { companyId, employeeId },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async update(companyId: string, employeeId: string, id: string, dto: UpdateBankAccountDto) {
    const current = await this.load(companyId, employeeId, id);
    this.assertPayable({ ...current, ...dto } as CreateBankAccountDto);

    return this.prisma.transaction(async () => {
      if (dto.isPrimary) {
        await this.clearPrimary(companyId, employeeId);
      }
      return this.prisma.db.employeeBankAccount.update({
        where: { id: current.id },
        data: {
          ...this.toColumns(dto),
          ...(dto.isPrimary !== undefined ? { isPrimary: dto.isPrimary } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      });
    });
  }

  /** Inativa: a conta que já recebeu crédito precisa continuar rastreável. */
  async remove(companyId: string, employeeId: string, id: string) {
    const current = await this.load(companyId, employeeId, id);
    return this.prisma.db.employeeBankAccount.update({
      where: { id: current.id },
      data: { isActive: false, isPrimary: false },
    });
  }

  private async load(companyId: string, employeeId: string, id: string) {
    const account = await this.prisma.db.employeeBankAccount.findFirst({
      where: { id, companyId, employeeId },
    });
    if (!account) {
      throw new NotFoundException('Dado bancário não encontrado.');
    }
    return account;
  }

  /** Só existe uma conta padrão por funcionário. */
  private async clearPrimary(companyId: string, employeeId: string) {
    await this.prisma.db.employeeBankAccount.updateMany({
      where: { companyId, employeeId, isPrimary: true },
      data: { isPrimary: false },
    });
  }

  /** Uma conta sem chave PIX e sem agência/conta não credita nada. */
  private assertPayable(dto: CreateBankAccountDto) {
    const hasAccount = Boolean(dto.bankCode && dto.agency && dto.account);
    const hasPix = Boolean(dto.pixKey && dto.pixKeyType);
    if (!hasAccount && !hasPix) {
      throw new BadRequestException(
        'Informe banco, agência e conta ou uma chave PIX com o respectivo tipo.',
      );
    }
  }

  private toColumns(dto: UpdateBankAccountDto) {
    return {
      ...(dto.bankCode !== undefined ? { bankCode: dto.bankCode } : {}),
      ...(dto.bankName !== undefined ? { bankName: dto.bankName } : {}),
      ...(dto.agency !== undefined ? { agency: dto.agency } : {}),
      ...(dto.agencyDigit !== undefined ? { agencyDigit: dto.agencyDigit } : {}),
      ...(dto.account !== undefined ? { account: dto.account } : {}),
      ...(dto.accountDigit !== undefined ? { accountDigit: dto.accountDigit } : {}),
      ...(dto.accountType !== undefined ? { accountType: dto.accountType } : {}),
      ...(dto.holderName !== undefined ? { holderName: dto.holderName } : {}),
      ...(dto.holderDocument !== undefined ? { holderDocument: dto.holderDocument } : {}),
      ...(dto.pixKey !== undefined ? { pixKey: dto.pixKey } : {}),
      ...(dto.pixKeyType !== undefined ? { pixKeyType: dto.pixKeyType } : {}),
    };
  }
}
