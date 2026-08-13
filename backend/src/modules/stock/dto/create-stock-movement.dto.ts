import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { IsUnitValue } from '../../../common/validators/decimal.decorator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * Tipos que a API aceita num lançamento avulso (RF-032).
 *
 * As pernas de transferência não estão aqui: uma transferência é uma operação
 * só, com duas pernas que precisam nascer juntas — vai por `POST
 * /stock/transfers`. `INVENTARIO` também fica de fora: o banco o recusa por não
 * ter sinal, e o ajuste da contagem sai do fechamento do inventário (RF-033).
 */
export enum StockEntryType {
  ENTRADA = 'ENTRADA',
  SAIDA = 'SAIDA',
  AJUSTE_POSITIVO = 'AJUSTE_POSITIVO',
  AJUSTE_NEGATIVO = 'AJUSTE_NEGATIVO',
}

/** Entrada, saída ou ajuste em um local (RF-032/RF-034). */
export class CreateStockMovementDto {
  @ApiProperty({ enum: StockEntryType })
  @IsEnum(StockEntryType)
  type!: StockEntryType;

  @ApiProperty()
  @IsUUID()
  productId!: string;

  @ApiProperty({ description: 'Local movimentado' })
  @IsUUID()
  locationId!: string;

  @ApiProperty({ description: 'Quantidade positiva (decimal, até 6 casas)' })
  @IsUnitValue()
  quantity!: string;

  @ApiPropertyOptional({
    description:
      'Custo unitário. Obrigatório na entrada; na saída, o padrão é o custo médio do local.',
  })
  @IsOptional()
  @IsUnitValue()
  unitCost?: string;

  @ApiPropertyOptional({ description: 'Data/hora do movimento (padrão: agora)' })
  @IsOptional()
  @IsISO8601()
  movementDate?: string;

  @ApiPropertyOptional({ description: 'Lote ou série' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Transform(trim)
  batch?: string;

  @ApiPropertyOptional({ description: 'Justificativa — exigida nos ajustes' })
  @IsOptional()
  @IsString()
  @Transform(trim)
  note?: string;
}
