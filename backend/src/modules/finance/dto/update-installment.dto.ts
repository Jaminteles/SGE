import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { IsDateOnly } from '../../../common/utils/date-only';
import { IsPercentage } from '../../../common/validators/decimal.decorator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * Ajustes na parcela em aberto (RF-055).
 *
 * O valor não está aqui: alterá-lo desequilibraria a soma das parcelas com o
 * valor líquido do título (RF-053). Renegociar valor é refazer o parcelamento
 * pelo título. Prorrogar vencimento é permitido — e o vencimento original fica
 * guardado pelo banco (bd/09), que é o que permite ver quantas vezes já foi.
 */
export class UpdateInstallmentDto {
  @ApiPropertyOptional({ description: 'Novo vencimento (prorrogação)' })
  @IsOptional()
  @IsDateOnly()
  dueDate?: string;

  @ApiPropertyOptional({ description: 'Juros de mora ao dia, em %' })
  @IsOptional()
  @IsPercentage()
  dailyInterestRate?: string;

  @ApiPropertyOptional({ description: 'Multa por atraso, em %' })
  @IsOptional()
  @IsPercentage()
  penaltyRate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Transform(trim)
  barcode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Transform(trim)
  digitableLine?: string;

  @ApiPropertyOptional()
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
