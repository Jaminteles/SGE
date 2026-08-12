import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { IsPercentage } from '../../../common/validators/decimal.decorator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const toInt = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? parseInt(value, 10) : value;

/**
 * Condição de pagamento (RF-026) — `gestao.condicao_pagamento`.
 *
 * Descreve o parcelamento acordado: quantas parcelas, quando vence a primeira e
 * de quanto em quanto tempo vencem as demais. O M08 usa esses números para
 * gerar as parcelas do título.
 */
export class CreatePaymentTermDto {
  @ApiProperty({ description: 'Código único na empresa', example: '30-60-90' })
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  @Transform(trim)
  code!: string;

  @ApiProperty({ example: 'Parcelado em 3x (30/60/90 dias)' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @Transform(trim)
  name!: string;

  @ApiPropertyOptional({ description: 'Quantidade de parcelas', default: 1 })
  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(360)
  installments?: number;

  @ApiPropertyOptional({ description: 'Intervalo entre parcelas, em dias', default: 30 })
  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(365)
  intervalDays?: number;

  @ApiPropertyOptional({ description: 'Dias até a primeira parcela (0 = à vista)', default: 30 })
  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(0)
  @Max(365)
  firstDueDays?: number;

  @ApiPropertyOptional({ description: 'Desconto concedido na condição (%)', default: '0' })
  @IsOptional()
  @IsPercentage()
  discountPercent?: string;
}
