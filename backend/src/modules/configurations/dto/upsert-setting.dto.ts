import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsDefined, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { SettingScope } from '../../../common/enums';

/**
 * Define/atualiza um parâmetro da empresa (RF-006).
 * `value` é gravado em jsonb: aceita string, número, booleano ou objeto.
 */
export class UpsertSettingDto {
  @ApiProperty({ enum: SettingScope, default: SettingScope.GERAL })
  @IsEnum(SettingScope)
  scope!: SettingScope;

  @ApiProperty({ description: 'Chave do parâmetro' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  key!: string;

  @ApiProperty({ description: 'Valor do parâmetro (JSON)', example: '30' })
  @IsDefined()
  value!: unknown;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
