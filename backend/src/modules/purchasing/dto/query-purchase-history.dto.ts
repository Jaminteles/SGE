import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { IsDateOnly } from '../../../common/utils/date-only';

/** Filtros do histórico de compras e preços (RF-042). */
export class QueryPurchaseHistoryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Item comprado' })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({ description: 'Fornecedor' })
  @IsOptional()
  @IsUUID()
  partnerId?: string;

  @ApiPropertyOptional({ description: 'Pedidos a partir desta data (inclusivo)' })
  @IsOptional()
  @IsDateOnly()
  from?: string;

  @ApiPropertyOptional({ description: 'Pedidos até esta data (inclusivo)' })
  @IsOptional()
  @IsDateOnly()
  to?: string;
}
