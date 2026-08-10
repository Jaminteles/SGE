import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/** Centro de custo (RF-006) — `gestao.centro_custo`. */
export class CreateCostCenterDto {
  @ApiProperty({ description: 'Código único do centro de custo na empresa' })
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ description: 'Centro de custo pai (hierarquia)' })
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @ApiPropertyOptional({ description: 'Filial à qual o centro de custo pertence' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ default: true, description: 'Aceita lançamento direto' })
  @IsOptional()
  @IsBoolean()
  acceptsEntry?: boolean;
}
