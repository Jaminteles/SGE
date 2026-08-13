import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { IsUnitValue } from '../../../common/validators/decimal.decorator';

/** Contagem apurada para um item do inventário (RF-033). */
export class InventoryCountDto {
  @ApiProperty({ description: 'Produto contado' })
  @IsUUID()
  productId!: string;

  @ApiProperty({ description: 'Quantidade contada (decimal, até 6 casas)' })
  @IsUnitValue()
  countedQuantity!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}

/** Lançamento em lote das contagens — a contagem chega por planilha ou coletor. */
export class CountInventoryDto {
  @ApiProperty({ type: [InventoryCountDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => InventoryCountDto)
  counts!: InventoryCountDto[];
}
