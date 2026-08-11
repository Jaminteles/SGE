import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { IsMoney } from '../../../common/validators/decimal.decorator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Cargo (RF-014) — `gestao.cargo`. */
export class CreatePositionDto {
  @ApiProperty({ description: 'Código único do cargo na empresa' })
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

  @ApiPropertyOptional({ description: 'Código da Classificação Brasileira de Ocupações' })
  @IsOptional()
  @Matches(/^\d{4,10}$/, { message: 'cbo deve conter apenas dígitos' })
  cbo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ description: 'Piso da faixa salarial (decimal)' })
  @IsOptional()
  @IsMoney()
  minSalary?: string;

  @ApiPropertyOptional({ description: 'Teto da faixa salarial (decimal)' })
  @IsOptional()
  @IsMoney()
  maxSalary?: string;
}
