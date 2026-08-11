import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID, Matches } from 'class-validator';

/** Consulta da consolidação para folha e contabilidade (RF-021). */
export class QueryPayrollDto {
  @ApiProperty({ description: 'Competência no formato YYYY-MM', example: '2026-09' })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'competence deve estar no formato YYYY-MM' })
  competence!: string;

  @ApiPropertyOptional({ description: 'Restringe a um centro de custo (RF-016)' })
  @IsOptional()
  @IsUUID()
  costCenterId?: string;

  @ApiPropertyOptional({ description: 'Restringe a um departamento' })
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional({ description: 'Restringe a um funcionário' })
  @IsOptional()
  @IsUUID()
  employeeId?: string;
}
