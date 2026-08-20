import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethodType, TransactionDirection } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { IsMoney } from '../../../common/validators/decimal.decorator';
import { IsDateOnly } from '../../../common/utils/date-only';
import { onlyDigits } from '../../../common/validators/is-cnpj.validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const digits = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? onlyDigits(value) : value;

/**
 * Modalidades que este módulo executa (RF-062).
 *
 * O enum do banco (`enum_metodo_pagamento`) é maior porque serve também à forma
 * de pagamento do título (RF-026): dinheiro, cheque e cartão são registros de
 * como algo foi quitado, não ordens que a API envia a um provedor.
 */
export const SUPPORTED_PAYMENT_METHODS = [
  PaymentMethodType.PIX,
  PaymentMethodType.BOLETO,
  PaymentMethodType.TED,
  PaymentMethodType.DOC,
  PaymentMethodType.TRANSFERENCIA_INTERNA,
] as const;

/**
 * Ordem de pagamento ou recebimento (RF-062 a RF-064).
 *
 * O favorecido é validado por modalidade em `PaymentTransactionsService`: PIX
 * exige chave, boleto exige código de barras, TED/DOC exigem banco, agência e
 * conta. Ficou no serviço, e não em decorator condicional, porque a regra também
 * depende das capacidades do provedor da conta.
 */
export class CreatePaymentDto {
  @ApiProperty({ description: 'Conta de onde o dinheiro sai (ou onde entra)' })
  @IsUUID()
  bankAccountId!: string;

  @ApiPropertyOptional({
    enum: TransactionDirection,
    default: TransactionDirection.DEBITO,
    description: 'DEBITO paga, CREDITO recebe',
  })
  @IsOptional()
  @IsEnum(TransactionDirection)
  direction?: TransactionDirection;

  @ApiProperty({ enum: SUPPORTED_PAYMENT_METHODS })
  @IsEnum(PaymentMethodType)
  method!: PaymentMethodType;

  @ApiProperty({ description: 'Valor decimal em string, maior que zero', example: '1250.00' })
  @IsMoney()
  amount!: string;

  @ApiPropertyOptional({ description: 'Identificação da ordem no extrato e nos relatórios' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Transform(trim)
  description?: string;

  @ApiPropertyOptional({
    description: 'Agendamento (RF-063). Ausente = executar assim que possível.',
  })
  @IsOptional()
  @IsDateOnly()
  scheduledFor?: string;

  @ApiPropertyOptional({
    description: 'Parcela do título que esta ordem liquida. A baixa é gerada na confirmação.',
  })
  @IsOptional()
  @IsUUID()
  installmentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Transform(trim)
  payeeName?: string;

  @ApiPropertyOptional({ description: 'CPF/CNPJ do favorecido (somente dígitos)' })
  @IsOptional()
  @Transform(digits)
  @Matches(/^(\d{11}|\d{14})$/, { message: 'payeeDocument deve ser um CPF ou CNPJ' })
  payeeDocument?: string;

  @ApiPropertyOptional({ description: 'Código COMPE do banco do favorecido' })
  @IsOptional()
  @Transform(digits)
  @Matches(/^\d{3,5}$/, { message: 'payeeBankCode deve conter de 3 a 5 dígitos' })
  payeeBankCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(digits)
  @Matches(/^\d{1,10}$/, { message: 'payeeAgency deve conter apenas dígitos' })
  payeeAgency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(digits)
  @Matches(/^\d{1,20}$/, { message: 'payeeAccount deve conter apenas dígitos' })
  payeeAccount?: string;

  @ApiPropertyOptional({ description: 'Chave PIX do favorecido (obrigatória no método PIX)' })
  @IsOptional()
  @IsString()
  @MaxLength(140)
  @Transform(trim)
  pixKey?: string;

  @ApiPropertyOptional({
    description: 'Código de barras ou linha digitável do boleto (somente dígitos)',
  })
  @IsOptional()
  @Transform(digits)
  @Matches(/^\d{44,48}$/, { message: 'barcode deve ter 44 (código de barras) ou 47/48 dígitos' })
  barcode?: string;
}
