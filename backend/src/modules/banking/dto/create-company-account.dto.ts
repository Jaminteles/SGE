import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { IsMoney } from '../../../common/validators/decimal.decorator';
import { onlyDigits } from '../../../common/validators/is-cnpj.validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const digits = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? onlyDigits(value) : value;

export const COMPANY_ACCOUNT_TYPES = ['CORRENTE', 'POUPANCA', 'PAGAMENTO'] as const;

/**
 * Conta bancária da empresa (RF-059) — `gestao.conta_bancaria`.
 *
 * É a conta de onde o dinheiro sai; não confundir com o dado bancário de
 * funcionário ou parceiro (`common/banking`), que é para onde ele vai.
 *
 * `saldoAtual` não está aqui de propósito: ele é o saldo informado pelo banco no
 * último extrato importado (RF-060), não um campo digitável.
 */
export class CreateCompanyAccountDto {
  @ApiProperty({ description: 'Como a conta aparece nas telas' })
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  description!: string;

  @ApiProperty({ description: 'Código COMPE do banco' })
  @Transform(digits)
  @Matches(/^\d{3,5}$/, { message: 'bankCode deve conter de 3 a 5 dígitos' })
  bankCode!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  bankName?: string;

  @ApiProperty({ description: 'Agência (somente dígitos)' })
  @Transform(digits)
  @Matches(/^\d{1,10}$/, { message: 'agency deve conter apenas dígitos' })
  agency!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^[0-9Xx]$/, { message: 'agencyDigit deve ser um dígito ou X' })
  agencyDigit?: string;

  @ApiProperty({ description: 'Conta (somente dígitos)' })
  @Transform(digits)
  @Matches(/^\d{1,20}$/, { message: 'account deve conter apenas dígitos' })
  account!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^[0-9Xx]$/, { message: 'accountDigit deve ser um dígito ou X' })
  accountDigit?: string;

  @ApiPropertyOptional({ enum: COMPANY_ACCOUNT_TYPES, default: 'CORRENTE' })
  @IsOptional()
  @IsIn(COMPANY_ACCOUNT_TYPES)
  accountType?: (typeof COMPANY_ACCOUNT_TYPES)[number];

  @ApiPropertyOptional({ description: 'Chave PIX de recebimento da conta' })
  @IsOptional()
  @IsString()
  @MaxLength(140)
  @Transform(trim)
  pixKey?: string;

  @ApiPropertyOptional({ description: 'Filial dona da conta' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ description: 'Provedor de integração (RF-061)' })
  @IsOptional()
  @IsUUID()
  providerId?: string;

  @ApiPropertyOptional({ description: 'Credencial usada para falar com o provedor' })
  @IsOptional()
  @IsUUID()
  credentialId?: string;

  @ApiPropertyOptional({ description: 'Saldo de abertura, para conferência', default: '0.00' })
  @IsOptional()
  @IsMoney()
  openingBalance?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  allowsPayment?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  allowsReceipt?: boolean;

  @ApiPropertyOptional({ description: 'Conta padrão da empresa', default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Transform(trim)
  note?: string;
}
