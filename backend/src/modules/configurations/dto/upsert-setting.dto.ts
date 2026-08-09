import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { SettingScope } from '@prisma/client';

/** Define/atualiza um parâmetro financeiro/fiscal da empresa (RF-006). */
export class UpsertSettingDto {
  @ApiProperty({ enum: SettingScope, default: SettingScope.GENERAL })
  @IsEnum(SettingScope)
  scope!: SettingScope;

  @ApiProperty({ description: 'Chave do parâmetro' })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  key!: string;

  @ApiProperty({ description: 'Valor do parâmetro' })
  @IsString()
  @MaxLength(500)
  value!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;
}
