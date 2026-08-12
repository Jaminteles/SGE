import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { onlyDigits } from '../../validators/is-cnpj.validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const digits = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? onlyDigits(value) : value;

export const ACCOUNT_TYPES = ['CORRENTE', 'POUPANCA', 'PAGAMENTO'] as const;
export const PIX_KEY_TYPES = ['CPF', 'CNPJ', 'EMAIL', 'TELEFONE', 'ALEATORIA'] as const;

/**
 * Dado bancário de funcionário (RF-013) ou parceiro (RF-024) —
 * `gestao.dado_bancario`. O contrato é o mesmo: muda só o dono da conta.
 *
 * É por aqui que o dinheiro sai da empresa: toda alteração fica na trilha de
 * auditoria (bd/06, bd/07) e o recurso tem permissão própria em cada módulo.
 */
export class CreateBankAccountDto {
  @ApiPropertyOptional({ description: 'Código COMPE do banco' })
  @IsOptional()
  @Transform(digits)
  @Matches(/^\d{3,5}$/, { message: 'bankCode deve conter de 3 a 5 dígitos' })
  bankCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  bankName?: string;

  @ApiPropertyOptional({ description: 'Agência (somente dígitos)' })
  @IsOptional()
  @Transform(digits)
  @Matches(/^\d{1,10}$/, { message: 'agency deve conter apenas dígitos' })
  agency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^[0-9Xx]$/, { message: 'agencyDigit deve ser um dígito ou X' })
  agencyDigit?: string;

  @ApiPropertyOptional({ description: 'Conta (somente dígitos)' })
  @IsOptional()
  @Transform(digits)
  @Matches(/^\d{1,20}$/, { message: 'account deve conter apenas dígitos' })
  account?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^[0-9Xx]$/, { message: 'accountDigit deve ser um dígito ou X' })
  accountDigit?: string;

  @ApiPropertyOptional({ enum: ACCOUNT_TYPES })
  @IsOptional()
  @IsIn(ACCOUNT_TYPES)
  accountType?: (typeof ACCOUNT_TYPES)[number];

  @ApiPropertyOptional({ description: 'Titular, quando diferente do dono da conta' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Transform(trim)
  holderName?: string;

  @ApiPropertyOptional({ description: 'CPF/CNPJ do titular (somente dígitos)' })
  @IsOptional()
  @Transform(digits)
  @Matches(/^(\d{11}|\d{14})$/, { message: 'holderDocument deve ser um CPF ou CNPJ' })
  holderDocument?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(140)
  @Transform(trim)
  pixKey?: string;

  @ApiPropertyOptional({ enum: PIX_KEY_TYPES })
  @IsOptional()
  @IsIn(PIX_KEY_TYPES)
  pixKeyType?: (typeof PIX_KEY_TYPES)[number];

  @ApiPropertyOptional({ description: 'Conta padrão para crédito', default: false })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}
