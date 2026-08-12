import { BadRequestException } from '@nestjs/common';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import { UpdateBankAccountDto } from './dto/update-bank-account.dto';

/**
 * Regras e mapeamento de `gestao.dado_bancario`, compartilhados pelos dois
 * donos possíveis da conta: funcionário (RF-013) e parceiro (RF-024).
 */

/** Uma conta sem chave PIX e sem agência/conta não credita nada. */
export function assertPayableAccount(dto: CreateBankAccountDto): void {
  const hasAccount = Boolean(dto.bankCode && dto.agency && dto.account);
  const hasPix = Boolean(dto.pixKey && dto.pixKeyType);
  if (!hasAccount && !hasPix) {
    throw new BadRequestException(
      'Informe banco, agência e conta ou uma chave PIX com o respectivo tipo.',
    );
  }
}

/** Só copia o que veio no payload — `undefined` é "não mexer". */
export function toBankAccountColumns(dto: UpdateBankAccountDto) {
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
