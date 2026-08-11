import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { IsDateOnly } from '../../../common/utils/date-only';

/** Desligamento (RF-015) — gera o evento DESLIGAMENTO no histórico. */
export class TerminateEmployeeDto {
  @ApiProperty({ description: 'Data do desligamento (YYYY-MM-DD)' })
  @IsDateOnly()
  terminationDate!: string;

  @ApiProperty({ description: 'Motivo do desligamento' })
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  reason!: string;

  @ApiPropertyOptional({ description: 'Observação registrada no histórico' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
