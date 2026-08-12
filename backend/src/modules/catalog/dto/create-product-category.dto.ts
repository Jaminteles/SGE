import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Categoria do catálogo (RF-029) — `gestao.categoria_produto`, hierárquica. */
export class CreateProductCategoryDto {
  @ApiProperty({ description: 'Código único na empresa' })
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

  @ApiPropertyOptional({ description: 'Categoria superior (hierarquia)' })
  @IsOptional()
  @IsUUID()
  parentId?: string;
}
