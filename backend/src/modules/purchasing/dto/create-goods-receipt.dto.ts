import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsMoney, IsUnitValue } from '../../../common/validators/decimal.decorator';
import { IsDateOnly } from '../../../common/utils/date-only';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Linha conferida na entrega (RF-039/RF-040). */
export class GoodsReceiptItemDto {
  @ApiProperty({ description: 'Item do pedido que está sendo conferido' })
  @IsUUID()
  orderItemId!: string;

  @ApiProperty({ description: 'Quantidade recebida — nunca acima do saldo do item' })
  @IsUnitValue()
  receivedQuantity!: string;

  @ApiPropertyOptional({
    description: 'Preço do documento do fornecedor; ausente significa igual ao pedido',
  })
  @IsOptional()
  @IsUnitValue()
  documentPrice?: string;

  @ApiPropertyOptional({
    description:
      'false recusa a linha: fica registrada, mas não abate o pedido nem entra no estoque',
  })
  @IsOptional()
  @IsBoolean()
  accepted?: boolean;

  @ApiPropertyOptional({ description: 'Local que recebeu (padrão: o do item ou o do recebimento)' })
  @IsOptional()
  @IsUUID()
  locationId?: string;

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

/**
 * Título a pagar gerado pela entrega (RF-041).
 *
 * Não há campo de valor: ele é o que chegou, pelo preço do documento, mais a
 * parcela do frete e das despesas do pedido. Valor informado pelo cliente aqui
 * seria uma segunda verdade sobre a mesma compra.
 */
export class GoodsReceiptPayableDto {
  @ApiPropertyOptional({ description: 'Categoria financeira (natureza PAGAR)' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  costCenterId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  paymentMethodId?: string;

  @ApiPropertyOptional({ description: 'Condição de pagamento — define o parcelamento' })
  @IsOptional()
  @IsUUID()
  paymentTermId?: string;

  @ApiPropertyOptional({ description: 'Vencimento da primeira parcela' })
  @IsOptional()
  @IsDateOnly()
  firstDueDate?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 120 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  installmentCount?: number;

  @ApiPropertyOptional({ description: 'Intervalo entre parcelas, em dias' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  intervalDays?: number;

  @ApiPropertyOptional({ description: 'Nota fiscal ou documento de referência' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Transform(trim)
  documentReference?: string;

  @ApiPropertyOptional({ description: 'Juros ao dia após o vencimento (%)' })
  @IsOptional()
  @IsMoney()
  dailyInterestRate?: string;

  @ApiPropertyOptional({ description: 'Multa por atraso (%)' })
  @IsOptional()
  @IsMoney()
  penaltyRate?: string;
}

/** Recebimento total ou parcial de um pedido (RF-039 a RF-041). */
export class CreateGoodsReceiptDto {
  @ApiPropertyOptional({ description: 'Data/hora da entrega (padrão: agora)' })
  @IsOptional()
  @IsISO8601()
  receivedAt?: string;

  @ApiPropertyOptional({ description: 'Local padrão da entrada de estoque' })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({
    description:
      'Nota fiscal que acompanha a entrega (M07/RF-047). Informada aqui porque o ' +
      'cabeçalho do recebimento é imutável: não há como vinculá-la depois.',
  })
  @IsOptional()
  @IsUUID()
  fiscalDocumentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(trim)
  note?: string;

  @ApiPropertyOptional({
    description: 'Gera o título a pagar do que foi recebido (RF-041). Padrão: false',
  })
  @IsOptional()
  @IsBoolean()
  generatePayable?: boolean;

  @ApiPropertyOptional({ type: GoodsReceiptPayableDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => GoodsReceiptPayableDto)
  payable?: GoodsReceiptPayableDto;

  @ApiProperty({ type: [GoodsReceiptItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => GoodsReceiptItemDto)
  items!: GoodsReceiptItemDto[];
}
