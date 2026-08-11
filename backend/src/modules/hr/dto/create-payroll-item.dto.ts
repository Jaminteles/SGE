import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PayrollItemType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Verba de folha (RF-017/RF-021) — `gestao.verba`. */
export class CreatePayrollItemDto {
  @ApiProperty({ description: 'Código único da verba na empresa' })
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  @Transform(trim)
  code!: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  @Transform(trim)
  name!: string;

  @ApiProperty({
    enum: PayrollItemType,
    description: 'Salário, benefício, desconto, adicional ou encargo',
  })
  @IsEnum(PayrollItemType)
  type!: PayrollItemType;

  @ApiPropertyOptional({ description: 'Categoria financeira para a contabilização (RF-021)' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ description: 'Conta contábil de destino (RF-021)' })
  @IsOptional()
  @IsUUID()
  ledgerAccountId?: string;

  @ApiPropertyOptional({ default: false, description: 'Compõe a base de INSS' })
  @IsOptional()
  @IsBoolean()
  affectsInss?: boolean;

  @ApiPropertyOptional({ default: false, description: 'Compõe a base de IRRF' })
  @IsOptional()
  @IsBoolean()
  affectsIrrf?: boolean;

  @ApiPropertyOptional({ default: false, description: 'Compõe a base de FGTS' })
  @IsOptional()
  @IsBoolean()
  affectsFgts?: boolean;
}
