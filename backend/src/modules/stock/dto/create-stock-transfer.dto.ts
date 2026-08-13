import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { IsUnitValue } from '../../../common/validators/decimal.decorator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * Transferência entre locais (RF-032).
 *
 * Vira duas linhas no razão — saída na origem e entrada no destino — gravadas
 * na mesma transação: meia transferência faria sumir estoque.
 */
export class CreateStockTransferDto {
  @ApiProperty()
  @IsUUID()
  productId!: string;

  @ApiProperty({ description: 'Local de origem' })
  @IsUUID()
  fromLocationId!: string;

  @ApiProperty({ description: 'Local de destino' })
  @IsUUID()
  toLocationId!: string;

  @ApiProperty({ description: 'Quantidade positiva (decimal, até 6 casas)' })
  @IsUnitValue()
  quantity!: string;

  @ApiPropertyOptional({ description: 'Data/hora da transferência (padrão: agora)' })
  @IsOptional()
  @IsISO8601()
  movementDate?: string;

  @ApiPropertyOptional({ description: 'Lote ou série' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Transform(trim)
  batch?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(trim)
  note?: string;
}
