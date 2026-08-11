import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Departamento (RF-014) — `gestao.departamento`. */
export class CreateDepartmentDto {
  @ApiProperty({ description: 'Código único do departamento na empresa' })
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

  @ApiPropertyOptional({ description: 'Departamento superior (hierarquia)' })
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @ApiPropertyOptional({ description: 'Centro de custo padrão do departamento (RF-016)' })
  @IsOptional()
  @IsUUID()
  costCenterId?: string;
}
