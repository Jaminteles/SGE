import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Unidade de medida (RF-029) — `gestao.unidade_medida`. */
export class CreateUnitDto {
  @ApiProperty({ description: 'Sigla única na empresa', example: 'UN' })
  @IsString()
  @MinLength(1)
  @MaxLength(6)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  symbol!: string;

  @ApiProperty({ example: 'Unidade' })
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  @Transform(trim)
  description!: string;
}
