import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Tipos aceitos em `endereco.tipo` (varchar livre no banco). */
export const ADDRESS_TYPES = ['PRINCIPAL', 'COBRANCA', 'ENTREGA', 'CORRESPONDENCIA'] as const;

/**
 * Endereço do parceiro (RF-024) — `gestao.endereco`.
 *
 * Diferente do endereço de empresa/filial (`AddressDto`, colunas achatadas no
 * cadastro), aqui o endereço é um recurso próprio: um parceiro tem vários, com
 * finalidades distintas — cobrança e entrega raramente coincidem.
 */
export class CreatePartnerAddressDto {
  @ApiPropertyOptional({ enum: ADDRESS_TYPES, default: 'PRINCIPAL' })
  @IsOptional()
  @IsIn(ADDRESS_TYPES)
  type?: (typeof ADDRESS_TYPES)[number];

  @ApiProperty()
  @IsString()
  @MaxLength(255)
  @Transform(trim)
  street!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(trim)
  number?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(trim)
  complement?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  district?: string;

  @ApiProperty()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  city!: string;

  @ApiProperty({ description: 'UF', example: 'SP' })
  @IsString()
  @Length(2, 2)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  state!: string;

  @ApiPropertyOptional({ description: 'CEP (somente dígitos)' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.replace(/\D/g, '') : value))
  @Length(8, 8, { message: 'zipCode deve conter 8 dígitos' })
  zipCode?: string;

  @ApiPropertyOptional({ default: 'Brasil' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Transform(trim)
  country?: string;

  @ApiPropertyOptional({ description: 'Código IBGE do município' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.replace(/\D/g, '') : value))
  @Length(7, 7, { message: 'ibgeCode deve conter 7 dígitos' })
  ibgeCode?: string;

  @ApiPropertyOptional({ description: 'Endereço principal do parceiro', default: false })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}
