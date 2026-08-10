import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { AddressDto } from '../../../common/dto/address.dto';
import { IsCnpj, onlyDigits } from '../../../common/validators/is-cnpj.validator';

/**
 * Filial (RF-002). `gestao.filial` não guarda e-mail/telefone próprios — esses
 * contatos pertencem a `gestao.contato` (módulo de parceiros, sprint futura).
 */
export class CreateBranchDto extends AddressDto {
  @ApiProperty({ description: 'Código único da filial na empresa' })
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  code!: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name!: string;

  @ApiPropertyOptional({ description: 'CNPJ da filial' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? onlyDigits(value) : value))
  @IsCnpj()
  taxId?: string;

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

  @ApiPropertyOptional({ default: false, description: 'Matriz (única por empresa)' })
  @IsOptional()
  @IsBoolean()
  isHeadquarters?: boolean;
}
