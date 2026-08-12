import { ApiProperty } from '@nestjs/swagger';
import { PaymentMethodType } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Forma de pagamento (RF-026) — `gestao.forma_pagamento`. */
export class CreatePaymentMethodDto {
  @ApiProperty({ description: 'Código único na empresa' })
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  @Transform(trim)
  code!: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @Transform(trim)
  name!: string;

  @ApiProperty({ enum: PaymentMethodType, description: 'Meio de liquidação' })
  @IsEnum(PaymentMethodType)
  method!: PaymentMethodType;
}
