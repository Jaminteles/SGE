import { ApiPropertyOptional } from '@nestjs/swagger';
import { EmployeeStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

/** Filtros da listagem de funcionários (RF-013/RF-016). */
export class QueryEmployeeDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: EmployeeStatus, description: 'Situação funcional' })
  @IsOptional()
  @IsEnum(EmployeeStatus)
  status?: EmployeeStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  positionId?: string;

  @ApiPropertyOptional({ description: 'Centro de custo de apropriação (RF-016)' })
  @IsOptional()
  @IsUUID()
  costCenterId?: string;

  @ApiPropertyOptional({ description: 'Gestor imediato' })
  @IsOptional()
  @IsUUID()
  managerId?: string;
}
