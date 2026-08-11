import { ApiPropertyOptional } from '@nestjs/swagger';
import { ReimbursementStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { IsDateOnly } from '../../../common/utils/date-only';

/** Filtros da listagem de reembolsos (RF-018). */
export class QueryReimbursementDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ReimbursementStatus })
  @IsOptional()
  @IsEnum(ReimbursementStatus)
  status?: ReimbursementStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional({ description: 'Solicitações a partir desta data (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateOnly()
  from?: string;

  @ApiPropertyOptional({ description: 'Solicitações até esta data (YYYY-MM-DD, inclusive)' })
  @IsOptional()
  @IsDateOnly()
  to?: string;
}
