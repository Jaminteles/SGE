import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * Abertura de inventário (RF-033).
 *
 * O número e a fotografia dos saldos são do servidor: o cliente diz onde e o
 * que contar, nunca quanto o sistema tinha.
 */
export class CreateInventoryDto {
  @ApiProperty({ description: 'Local a ser contado' })
  @IsUUID()
  locationId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Transform(trim)
  description?: string;

  @ApiPropertyOptional({ description: 'Responsável pela contagem (usuário da empresa)' })
  @IsOptional()
  @IsUUID()
  responsibleId?: string;

  @ApiPropertyOptional({
    description:
      'Itens a contar. Omitido, entram todos os produtos com saldo no local (contagem geral).',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID('4', { each: true })
  productIds?: string[];
}
