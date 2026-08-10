import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { TaxRegime } from '@prisma/client';
import { AddressDto } from '../../../common/dto/address.dto';
import { IsCnpj, onlyDigits } from '../../../common/validators/is-cnpj.validator';

export class CreateCompanyDto extends AddressDto {
  @ApiProperty({ description: 'Razão social' })
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  legalName!: string;

  @ApiPropertyOptional({ description: 'Nome fantasia' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  tradeName?: string;

  @ApiProperty({ description: 'CNPJ (com ou sem máscara)' })
  @Transform(({ value }) => (typeof value === 'string' ? onlyDigits(value) : value))
  @IsCnpj()
  taxId!: string;

  @ApiPropertyOptional({ description: 'Inscrição estadual' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  stateRegistration?: string;

  @ApiPropertyOptional({ description: 'Inscrição municipal' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  municipalRegistration?: string;

  @ApiPropertyOptional({ enum: TaxRegime, description: 'Regime tributário' })
  @IsOptional()
  @IsEnum(TaxRegime)
  taxRegime?: TaxRegime;

  @ApiPropertyOptional({ description: 'CNAE principal' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  mainCnae?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;
}
