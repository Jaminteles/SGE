import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { InventoryStatus } from '../../../common/enums';

/** Filtros da listagem de inventários (RF-033). */
export class QueryInventoryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: InventoryStatus })
  @IsOptional()
  @IsEnum(InventoryStatus)
  status?: InventoryStatus;

  @ApiPropertyOptional({ description: 'Local contado' })
  @IsOptional()
  @IsUUID()
  locationId?: string;
}
