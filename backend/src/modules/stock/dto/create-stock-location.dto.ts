import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Local de estoque — depósito ou almoxarifado de uma filial (RF-031). */
export class CreateStockLocationDto {
  @ApiProperty({ description: 'Filial onde o local fica' })
  @IsUUID()
  branchId!: string;

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

  @ApiPropertyOptional({
    description: 'Local padrão da filial — destino assumido quando nenhum é informado',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
