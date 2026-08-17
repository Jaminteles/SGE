import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { IsMoney, IsUnitValue } from '../../../common/validators/decimal.decorator';
import { IsDateOnly } from '../../../common/utils/date-only';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * Item negociado do pedido (RF-037).
 *
 * `lineAmount` não existe aqui: é quantidade × preço − desconto, calculado pelo
 * banco (bd/11). Dois números para o mesmo fato divergem no primeiro acerto.
 */
export class PurchaseOrderItemDto {
  @ApiPropertyOptional({ description: 'Item do catálogo; ausente para compra avulsa' })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({ description: 'Descrição da linha (padrão: a do produto)' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Transform(trim)
  description?: string;

  @ApiProperty({ description: 'Quantidade pedida (decimal, até 6 casas)' })
  @IsUnitValue()
  quantity!: string;

  @ApiProperty({ description: 'Preço unitário negociado' })
  @IsUnitValue()
  unitPrice!: string;

  @ApiPropertyOptional({ description: 'Desconto da linha' })
  @IsOptional()
  @IsMoney()
  discountAmount?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  costCenterId?: string;

  @ApiPropertyOptional({ description: 'Local onde a mercadoria será recebida' })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(trim)
  note?: string;
}

/** Pedido de compra (RF-036/RF-037). Nasce em RASCUNHO. */
export class CreatePurchaseOrderDto {
  @ApiProperty({ description: 'Fornecedor — precisa exercer o papel (RF-023)' })
  @IsUUID()
  partnerId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ description: 'Comprador responsável (funcionário)' })
  @IsOptional()
  @IsUUID()
  buyerId?: string;

  @ApiPropertyOptional({ description: 'Data do pedido (padrão: hoje)' })
  @IsOptional()
  @IsDateOnly()
  orderDate?: string;

  @ApiPropertyOptional({ description: 'Previsão de entrega' })
  @IsOptional()
  @IsDateOnly()
  expectedDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  paymentTermId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  paymentMethodId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  costCenterId?: string;

  @ApiPropertyOptional({ description: 'Categoria financeira — precisa ser de PAGAR' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ description: 'Desconto negociado no pedido' })
  @IsOptional()
  @IsMoney()
  discountAmount?: string;

  @ApiPropertyOptional({ description: 'Frete cobrado pelo fornecedor' })
  @IsOptional()
  @IsMoney()
  freightAmount?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMoney()
  insuranceAmount?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMoney()
  otherExpenseAmount?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(trim)
  note?: string;

  @ApiProperty({ type: [PurchaseOrderItemDto], description: 'Itens do pedido (ao menos um)' })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderItemDto)
  items!: PurchaseOrderItemDto[];
}
