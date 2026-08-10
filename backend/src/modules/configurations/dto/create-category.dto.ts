import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
import { EntryType } from '@prisma/client';

/** Categoria financeira (RF-006) — `gestao.categoria_financeira`. */
export class CreateCategoryDto {
  @ApiProperty({ description: 'Código único da categoria na empresa' })
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  code!: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name!: string;

  @ApiProperty({ enum: EntryType, description: 'Natureza: PAGAR ou RECEBER' })
  @IsEnum(EntryType)
  type!: EntryType;

  @ApiPropertyOptional({ description: 'Categoria pai (hierarquia)' })
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @ApiPropertyOptional({ default: true, description: 'Categoria analítica aceita lançamento' })
  @IsOptional()
  @IsBoolean()
  acceptsEntry?: boolean;
}
