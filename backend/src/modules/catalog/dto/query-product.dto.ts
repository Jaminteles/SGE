import { ApiPropertyOptional } from '@nestjs/swagger';
import { ItemType } from '@prisma/client';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

/** Filtros da listagem do catálogo (RF-028/RF-029). */
export class QueryProductDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ItemType })
  @IsOptional()
  @IsEnum(ItemType)
  type?: ItemType;

  @ApiPropertyOptional({ description: 'Categoria do catálogo' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ description: 'Fornecedor associado ao item (RF-027)' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;
}
