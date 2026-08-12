import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { IsDateOnly } from '../../../common/utils/date-only';

/** Recorte do histórico do parceiro (RF-025). */
export class QueryPartnerHistoryDto {
  @ApiPropertyOptional({ description: 'Início do período (YYYY-MM-DD, inclusivo)' })
  @IsOptional()
  @IsDateOnly()
  from?: string;

  @ApiPropertyOptional({ description: 'Fim do período (YYYY-MM-DD, inclusivo)' })
  @IsOptional()
  @IsDateOnly()
  to?: string;

  @ApiPropertyOptional({
    description: 'Quantidade de lançamentos recentes retornados',
    default: 10,
    maximum: 50,
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? parseInt(value, 10) : value))
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
