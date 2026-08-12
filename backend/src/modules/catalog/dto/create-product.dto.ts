import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ItemType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { IsPercentage, IsUnitValue } from '../../../common/validators/decimal.decorator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const digits = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.replace(/\D/g, '') : value;
const toInt = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? parseInt(value, 10) : value;

/**
 * Produto ou serviço (RF-028, RF-029, RF-030) — `gestao.produto`.
 *
 * Custo médio e custo da última compra não entram: são projetados pela
 * movimentação de estoque e pelas compras (Sprints 5 e 8). O que o cadastro
 * define é o preço de venda e a margem de referência.
 */
export class CreateProductDto {
  @ApiPropertyOptional({ enum: ItemType, default: ItemType.PRODUTO })
  @IsOptional()
  @IsEnum(ItemType)
  type?: ItemType;

  @ApiProperty({ description: 'Código interno único na empresa (SKU)' })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  @Transform(trim)
  code!: string;

  @ApiPropertyOptional({ description: 'Código de barras (EAN/GTIN)' })
  @IsOptional()
  @Transform(digits)
  @Matches(/^\d{8,14}$/, { message: 'barcode deve conter de 8 a 14 dígitos' })
  barcode?: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  @Transform(trim)
  description!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(trim)
  extraDescription?: string;

  @ApiPropertyOptional({ description: 'Categoria do catálogo (RF-029)' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ description: 'Unidade de medida comercial (RF-029)' })
  @IsOptional()
  @IsUUID()
  unitId?: string;

  @ApiPropertyOptional({ description: 'NCM — 8 dígitos (RF-030)' })
  @IsOptional()
  @Transform(digits)
  @Matches(/^\d{8}$/, { message: 'ncm deve conter 8 dígitos' })
  ncm?: string;

  @ApiPropertyOptional({ description: 'CEST — 7 dígitos (RF-030)' })
  @IsOptional()
  @Transform(digits)
  @Matches(/^\d{7}$/, { message: 'cest deve conter 7 dígitos' })
  cest?: string;

  @ApiPropertyOptional({ description: 'CFOP padrão de entrada — 4 dígitos' })
  @IsOptional()
  @Transform(digits)
  @Matches(/^\d{4}$/, { message: 'defaultInboundCfop deve conter 4 dígitos' })
  defaultInboundCfop?: string;

  @ApiPropertyOptional({ description: 'CFOP padrão de saída — 4 dígitos' })
  @IsOptional()
  @Transform(digits)
  @Matches(/^\d{4}$/, { message: 'defaultOutboundCfop deve conter 4 dígitos' })
  defaultOutboundCfop?: string;

  @ApiPropertyOptional({ description: 'Origem da mercadoria (0 a 8, tabela A do ICMS)' })
  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(0)
  @Max(8)
  goodsOrigin?: number;

  @ApiPropertyOptional({ description: 'Código de serviço da LC 116 — obrigatório em serviço' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  @Transform(trim)
  serviceCodeLc116?: string;

  @ApiPropertyOptional({ description: 'Preço de venda (decimal, até 6 casas)' })
  @IsOptional()
  @IsUnitValue()
  salePrice?: string;

  @ApiPropertyOptional({ description: 'Margem de referência (%)' })
  @IsOptional()
  @IsPercentage()
  defaultMargin?: string;

  @ApiPropertyOptional({ description: 'Controla estoque — sempre falso em serviço', default: true })
  @IsOptional()
  @IsBoolean()
  tracksStock?: boolean;

  @ApiPropertyOptional({ description: 'Estoque mínimo (decimal)', default: '0' })
  @IsOptional()
  @IsUnitValue()
  minStock?: string;

  @ApiPropertyOptional({ description: 'Estoque máximo (decimal)' })
  @IsOptional()
  @IsUnitValue()
  maxStock?: string;

  @ApiPropertyOptional({ description: 'Peso líquido em kg' })
  @IsOptional()
  @IsUnitValue()
  netWeight?: string;

  @ApiPropertyOptional({ description: 'Peso bruto em kg' })
  @IsOptional()
  @IsUnitValue()
  grossWeight?: string;
}
