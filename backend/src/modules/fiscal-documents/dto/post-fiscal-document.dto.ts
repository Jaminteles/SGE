import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
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
import { IsMoney } from '../../../common/validators/decimal.decorator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Como o título a pagar da nota deve nascer (RF-047 → RF-053/RF-055). */
export class FiscalDocumentPayableDto {
  @ApiPropertyOptional({ description: 'Categoria financeira do título' })
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

  @ApiPropertyOptional({ description: 'Condição de pagamento — define o parcelamento' })
  @IsOptional()
  @IsUUID()
  paymentTermId?: string;

  @ApiPropertyOptional({ description: 'Vencimento da primeira parcela' })
  @IsOptional()
  @IsDateOnly()
  firstDueDate?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 120 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  installmentCount?: number;

  @ApiPropertyOptional({ description: 'Intervalo entre parcelas, em dias' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  intervalDays?: number;

  @ApiPropertyOptional({ description: 'Juros ao dia após o vencimento (%)' })
  @IsOptional()
  @IsMoney()
  dailyInterestRate?: string;

  @ApiPropertyOptional({ description: 'Multa por atraso (%)' })
  @IsOptional()
  @IsMoney()
  penaltyRate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trim)
  note?: string;
}

/**
 * Efeitos que a nota deve produzir (RF-047).
 *
 * Pedir explicitamente cada efeito é proposital: dar entrada no estoque e
 * assumir uma conta a pagar são decisões de quem confere a nota, não
 * consequências automáticas de um upload. Nenhum dos dois se desfaz — o estorno
 * é lançamento contrário no razão e cancelamento no título.
 */
export class PostFiscalDocumentDto {
  @ApiProperty({ description: 'Dá entrada no estoque dos itens vinculados a produto' })
  @IsBoolean()
  generateStock!: boolean;

  @ApiProperty({ description: 'Gera o título a pagar do valor da nota' })
  @IsBoolean()
  generatePayable!: boolean;

  @ApiPropertyOptional({
    description: 'Local de estoque da entrada — obrigatório quando `generateStock`',
  })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({ type: FiscalDocumentPayableDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => FiscalDocumentPayableDto)
  payable?: FiscalDocumentPayableDto;
}
