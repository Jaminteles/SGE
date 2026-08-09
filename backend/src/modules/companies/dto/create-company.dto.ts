import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { AddressDto } from '../../../common/dto/address.dto';
import { IsCnpj, onlyDigits } from '../../../common/validators/is-cnpj.validator';

export class CreateCompanyDto extends AddressDto {
  @ApiProperty({ description: 'Razão social' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  legalName!: string;

  @ApiPropertyOptional({ description: 'Nome fantasia' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  tradeName?: string;

  @ApiProperty({ description: 'CNPJ (com ou sem máscara)' })
  @Transform(({ value }) => (typeof value === 'string' ? onlyDigits(value) : value))
  @IsCnpj()
  taxId!: string;

  @ApiPropertyOptional({ description: 'Inscrição estadual' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  stateRegistration?: string;

  @ApiPropertyOptional({ description: 'Inscrição municipal' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  municipalRegistration?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @MaxLength(180)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;
}
