import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import { IsDateOnly } from '../../../common/utils/date-only';
import { IsMoney } from '../../../common/validators/decimal.decorator';

/** Geração dos títulos vencidos da recorrência até uma data (RF-053). */
export class GenerateRecurrenceDto {
  @ApiPropertyOptional({
    description: 'Gera todas as ocorrências devidas até esta data (padrão: hoje)',
  })
  @IsOptional()
  @IsDateOnly()
  until?: string;

  @ApiPropertyOptional({
    description: 'Valor desta rodada. Sem ele, vale o valor padrão da recorrência.',
  })
  @IsOptional()
  @IsMoney()
  amount?: string;
}
