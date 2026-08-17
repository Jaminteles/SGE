import { ApiPropertyOptional } from '@nestjs/swagger';
import { ApprovalStatus, PurchaseOrderStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { IsDateOnly } from '../../../common/utils/date-only';

const toBoolean = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

/** Filtros do acompanhamento de pedidos (RF-036). */
export class QueryPurchaseOrderDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PurchaseOrderStatus })
  @IsOptional()
  @IsEnum(PurchaseOrderStatus)
  status?: PurchaseOrderStatus;

  @ApiPropertyOptional({ enum: ApprovalStatus })
  @IsOptional()
  @IsEnum(ApprovalStatus)
  approvalStatus?: ApprovalStatus;

  @ApiPropertyOptional({ description: 'Fornecedor' })
  @IsOptional()
  @IsUUID()
  partnerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ description: 'Pedidos a partir desta data (inclusivo)' })
  @IsOptional()
  @IsDateOnly()
  from?: string;

  @ApiPropertyOptional({ description: 'Pedidos até esta data (inclusivo)' })
  @IsOptional()
  @IsDateOnly()
  to?: string;

  @ApiPropertyOptional({ description: 'Somente pedidos aprovados com entrega pendente' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  pendingReceiptOnly?: boolean;
}
