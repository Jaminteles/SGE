import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PersonType, TaxRegime } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsCnpj, onlyDigits } from '../../../common/validators/is-cnpj.validator';
import { IsCpf } from '../../../common/validators/is-cpf.validator';
import { CustomerProfileDto } from './customer-profile.dto';
import { SupplierProfileDto } from './supplier-profile.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const digits = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? onlyDigits(value) : value;

/**
 * Cliente e/ou fornecedor (RF-022, RF-023) — `gestao.parceiro`.
 *
 * Um cadastro só, com dois papéis: a mesma empresa costuma ser fornecedora e
 * cliente, e duplicar o cadastro é o que faz o CNPJ aparecer duas vezes com
 * dados divergentes. Os dados de cada papel vão em `customer`/`supplier`.
 */
export class CreatePartnerDto {
  @ApiProperty({ enum: PersonType })
  @IsEnum(PersonType)
  personType!: PersonType;

  @ApiPropertyOptional({ description: 'Código interno único na empresa' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Transform(trim)
  code?: string;

  @ApiProperty({ description: 'Razão social ou nome completo' })
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  @Transform(trim)
  legalName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Transform(trim)
  tradeName?: string;

  @ApiPropertyOptional({ description: 'CNPJ — obrigatório para PJ' })
  @ValidateIf((dto: CreatePartnerDto) => dto.personType === PersonType.PJ || dto.cnpj != null)
  @Transform(digits)
  @IsCnpj()
  cnpj?: string;

  @ApiPropertyOptional({ description: 'CPF — obrigatório para PF' })
  @ValidateIf((dto: CreatePartnerDto) => dto.personType === PersonType.PF || dto.cpf != null)
  @Transform(digits)
  @IsCpf()
  cpf?: string;

  @ApiPropertyOptional({ description: 'Documento — obrigatório para ESTRANGEIRO' })
  @ValidateIf((dto: CreatePartnerDto) => dto.personType === PersonType.ESTRANGEIRO)
  @IsString()
  @MinLength(3)
  @MaxLength(30)
  @Transform(trim)
  foreignDocument?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(trim)
  stateRegistration?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(trim)
  municipalRegistration?: string;

  @ApiPropertyOptional({ description: 'Contribuinte de ICMS', default: false })
  @IsOptional()
  @IsBoolean()
  icmsTaxpayer?: boolean;

  @ApiPropertyOptional({ enum: TaxRegime })
  @IsOptional()
  @IsEnum(TaxRegime)
  taxRegime?: TaxRegime;

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
  @Transform(trim)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ require_protocol: true }, { message: 'website deve ser uma URL com protocolo' })
  @MaxLength(255)
  @Transform(trim)
  website?: string;

  @ApiPropertyOptional({ description: 'Exerce o papel de cliente (RF-022)', default: false })
  @IsOptional()
  @IsBoolean()
  isCustomer?: boolean;

  @ApiPropertyOptional({ description: 'Exerce o papel de fornecedor (RF-023)', default: false })
  @IsOptional()
  @IsBoolean()
  isSupplier?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(trim)
  note?: string;

  @ApiPropertyOptional({ description: 'Dados do papel cliente (RF-026)', type: CustomerProfileDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CustomerProfileDto)
  customer?: CustomerProfileDto;

  @ApiPropertyOptional({
    description: 'Dados do papel fornecedor (RF-026)',
    type: SupplierProfileDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => SupplierProfileDto)
  supplier?: SupplierProfileDto;
}
