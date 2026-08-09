import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { SettingScope } from '@prisma/client';

export class CreateCategoryDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name!: string;

  @ApiPropertyOptional({ enum: SettingScope, default: SettingScope.FINANCIAL })
  @IsOptional()
  @IsEnum(SettingScope)
  scope?: SettingScope;

  @ApiPropertyOptional({ description: 'Categoria pai (hierarquia)' })
  @IsOptional()
  @IsString()
  parentId?: string;
}
