import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { IsUnitValue } from '../../../common/validators/decimal.decorator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * Vínculo fornecedor ↔ produto (RF-027) — `gestao.produto_fornecedor`.
 *
 * O código no fornecedor é o que permite reconhecer o item na NF-e de entrada,
 * onde ele vem com a numeração de quem emitiu, não com a nossa.
 */
export class CreateProductSupplierDto {
  @ApiProperty({ description: 'Parceiro com papel de fornecedor (RF-023)' })
  @IsUUID()
  partnerId!: string;

  @ApiPropertyOptional({ description: 'Código do item no catálogo do fornecedor' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Transform(trim)
  supplierCode?: string;

  @ApiPropertyOptional({ description: 'Preço de referência negociado (decimal)' })
  @IsOptional()
  @IsUnitValue()
  referencePrice?: string;

  @ApiPropertyOptional({ description: 'Prazo de entrega do fornecedor, em dias' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? parseInt(value, 10) : value))
  @IsInt()
  @Min(0)
  @Max(999)
  deliveryDays?: number;

  @ApiPropertyOptional({ description: 'Fornecedor preferencial do item', default: false })
  @IsOptional()
  @IsBoolean()
  isPreferred?: boolean;
}
