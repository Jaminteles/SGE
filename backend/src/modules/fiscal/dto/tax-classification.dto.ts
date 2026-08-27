import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString, Length } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { TaxClassificationType } from '../../../common/enums';
import { IsPercentage } from '../../../common/validators/decimal.decorator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * Cadastro da classificação fiscal (RF-089).
 *
 * O formato do código é conferido contra o tipo no serviço e de novo no banco
 * (bd/18 §3): um NCM com sete dígitos não casa com item nenhum, e a regra fiscal
 * presa a ele deixa de valer sem que ninguém perceba.
 */
export class CreateTaxClassificationDto {
  @ApiProperty({ enum: TaxClassificationType })
  @IsEnum(TaxClassificationType)
  type!: TaxClassificationType;

  @ApiProperty({ example: '84713012', maxLength: 30 })
  @IsString()
  @Length(1, 30)
  @Transform(trim)
  code!: string;

  @ApiProperty({ maxLength: 255 })
  @IsString()
  @Length(2, 255)
  @Transform(trim)
  description!: string;

  @ApiPropertyOptional({ description: 'Alíquota de ICMS esperada para esta classificação' })
  @IsOptional()
  @IsPercentage()
  icmsRate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsPercentage()
  ipiRate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsPercentage()
  pisRate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsPercentage()
  cofinsRate?: string;
}

/**
 * Alteração da classificação.
 *
 * `type` e `code` ficam de fora: são a identidade da linha (a unique é
 * `empresa, tipo, codigo`) e já podem estar apontados por regras fiscais e por
 * itens de notas recebidas. Reescrevê-los reclassificaria retroativamente notas
 * fechadas. O caminho é cadastrar a classificação nova e inativar a antiga.
 */
export class UpdateTaxClassificationDto {
  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @Length(2, 255)
  @Transform(trim)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsPercentage()
  icmsRate?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsPercentage()
  ipiRate?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsPercentage()
  pisRate?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsPercentage()
  cofinsRate?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** Filtros da classificação fiscal (RF-089). */
export class QueryTaxClassificationDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: TaxClassificationType })
  @IsOptional()
  @IsEnum(TaxClassificationType)
  type?: TaxClassificationType;
}
