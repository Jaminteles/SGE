import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EntryType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsDateOnly } from '../../../common/utils/date-only';
import { IsMoney, IsPercentage } from '../../../common/validators/decimal.decorator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Uma parcela informada explicitamente (RF-053). */
export class FinancialEntryInstallmentDto {
  @ApiProperty({ description: 'Vencimento (YYYY-MM-DD)' })
  @IsDateOnly()
  dueDate!: string;

  @ApiProperty({ description: 'Valor da parcela (decimal em string)' })
  @IsMoney()
  amount!: string;

  @ApiPropertyOptional({ description: 'Juros de mora ao dia, em % (padrão: 0)' })
  @IsOptional()
  @IsPercentage()
  dailyInterestRate?: string;

  @ApiPropertyOptional({ description: 'Multa por atraso, em % (padrão: 0)' })
  @IsOptional()
  @IsPercentage()
  penaltyRate?: string;

  @ApiPropertyOptional({ description: 'Código de barras do boleto' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Transform(trim)
  barcode?: string;

  @ApiPropertyOptional({ description: 'Linha digitável' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Transform(trim)
  digitableLine?: string;

  @ApiPropertyOptional({ description: 'Nosso número' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Transform(trim)
  bankIdentifier?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(trim)
  note?: string;
}

/**
 * Título a pagar ou a receber (RF-051/RF-052).
 *
 * As parcelas podem vir de três lugares, e é o service que escolhe: a lista
 * explícita, se informada; a condição de pagamento do cadastro (RF-026); ou o
 * parcelamento simples (`installmentCount` + intervalo). Sem nada disso, o
 * título nasce com uma parcela única — que é o caso mais comum.
 */
export class CreateFinancialEntryDto {
  @ApiProperty({ enum: EntryType, description: 'PAGAR (fornecedor) ou RECEBER (cliente)' })
  @IsEnum(EntryType)
  type!: EntryType;

  @ApiProperty()
  @IsString()
  @MaxLength(255)
  @Transform(trim)
  description!: string;

  @ApiPropertyOptional({
    description: 'Parceiro devedor/credor — exigido se não houver funcionário',
  })
  @IsOptional()
  @IsUUID()
  partnerId?: string;

  @ApiPropertyOptional({ description: 'Funcionário credor (reembolso) — alternativa ao parceiro' })
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ description: 'Número da NF, contrato ou documento de origem' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Transform(trim)
  documentReference?: string;

  @ApiPropertyOptional({ description: 'Emissão (padrão: hoje)' })
  @IsOptional()
  @IsDateOnly()
  issueDate?: string;

  @ApiPropertyOptional({ description: 'Competência (padrão: a emissão)' })
  @IsOptional()
  @IsDateOnly()
  competenceDate?: string;

  @ApiProperty({ description: 'Valor bruto (decimal em string)' })
  @IsMoney()
  grossAmount!: string;

  @ApiPropertyOptional({ description: 'Desconto concedido na emissão (padrão: 0)' })
  @IsOptional()
  @IsMoney()
  discountAmount?: string;

  @ApiPropertyOptional({ description: 'Categoria financeira — precisa ser do mesmo tipo (RF-054)' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  costCenterId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  paymentMethodId?: string;

  @ApiPropertyOptional({ description: 'Condição de pagamento: define o parcelamento (RF-026)' })
  @IsOptional()
  @IsUUID()
  paymentTermId?: string;

  @ApiPropertyOptional({ type: [FinancialEntryInstallmentDto], description: 'Parcelas explícitas' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(360)
  @ValidateNested({ each: true })
  @Type(() => FinancialEntryInstallmentDto)
  installments?: FinancialEntryInstallmentDto[];

  @ApiPropertyOptional({ description: 'Quantidade de parcelas iguais (padrão: 1)', minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(360)
  installmentCount?: number;

  @ApiPropertyOptional({ description: 'Vencimento da primeira parcela (padrão: a emissão)' })
  @IsOptional()
  @IsDateOnly()
  firstDueDate?: string;

  @ApiPropertyOptional({ description: 'Intervalo entre parcelas em dias (padrão: 30)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  intervalDays?: number;

  @ApiPropertyOptional({ description: 'Juros de mora ao dia (%) aplicado a todas as parcelas' })
  @IsOptional()
  @IsPercentage()
  dailyInterestRate?: string;

  @ApiPropertyOptional({ description: 'Multa por atraso (%) aplicada a todas as parcelas' })
  @IsOptional()
  @IsPercentage()
  penaltyRate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(trim)
  note?: string;
}
