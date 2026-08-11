import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { IsMoney, IsPercentage } from '../../../common/validators/decimal.decorator';
import { IsDateOnly } from '../../../common/utils/date-only';

/**
 * Verba atribuída a um funcionário (RF-017) — `gestao.funcionario_verba`.
 *
 * Valor fixo ou percentual: o banco exige um dos dois e recusa vigências
 * sobrepostas para a mesma verba (bd/06).
 */
export class CreateCompensationDto {
  @ApiProperty({ description: 'Verba do catálogo da empresa' })
  @IsUUID()
  payrollItemId!: string;

  @ApiPropertyOptional({ description: 'Valor fixo (decimal)' })
  @IsOptional()
  @IsMoney()
  amount?: string;

  @ApiPropertyOptional({ description: 'Percentual sobre o salário base (0 a 100)' })
  @IsOptional()
  @IsPercentage()
  percentage?: string;

  @ApiProperty({ description: 'Início da vigência (YYYY-MM-DD)' })
  @IsDateOnly()
  effectiveFrom!: string;

  @ApiPropertyOptional({ description: 'Fim da vigência (YYYY-MM-DD). Vazio = sem prazo.' })
  @IsOptional()
  @IsDateOnly()
  effectiveTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
