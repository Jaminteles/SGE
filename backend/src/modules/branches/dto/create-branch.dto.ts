import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { AddressDto } from '../../../common/dto/address.dto';
import { IsCnpj, onlyDigits } from '../../../common/validators/is-cnpj.validator';

export class CreateBranchDto extends AddressDto {
  @ApiProperty({ description: 'Código único da filial na empresa' })
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  code!: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name!: string;

  @ApiPropertyOptional({ description: 'CNPJ da filial' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? onlyDigits(value) : value))
  @IsCnpj()
  taxId?: string;

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
