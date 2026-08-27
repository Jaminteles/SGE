import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { TaxOperationType } from '../../../common/enums';
import { IsDateOnly } from '../../../common/utils/date-only';
import { IsPercentage } from '../../../common/validators/decimal.decorator';
import { CFOP_PATTERN, UF_PATTERN } from '../fiscal.constants';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/**
 * Cadastro da regra fiscal (RF-091).
 *
 * Pelo menos um critério é obrigatório — o serviço recusa e o banco recusa de
 * novo (bd/18 §5). Regra sem critério casa com toda operação da empresa e, como
 * a resolução ordena por prioridade, passa a decidir a tributação de tudo.
 */
export class CreateTaxRuleDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @Length(2, 120)
  @Transform(trim)
  name!: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 999,
    default: 100,
    description: 'Menor número decide primeiro.',
  })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? value : parseInt(value as string, 10)))
  @IsInt()
  @Min(1)
  @Max(999)
  priority?: number;

  @ApiPropertyOptional({ example: 'SP' })
  @IsOptional()
  @Transform(upper)
  @Matches(UF_PATTERN, { message: 'originState deve ser uma UF de duas letras' })
  originState?: string;

  @ApiPropertyOptional({ example: 'MG' })
  @IsOptional()
  @Transform(upper)
  @Matches(UF_PATTERN, { message: 'destinationState deve ser uma UF de duas letras' })
  destinationState?: string;

  @ApiPropertyOptional({ enum: TaxOperationType })
  @IsOptional()
  @IsEnum(TaxOperationType)
  operationType?: TaxOperationType;

  @ApiPropertyOptional({ description: 'Classificação fiscal a que a regra se aplica' })
  @IsOptional()
  @IsUUID()
  classificationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  productCategoryId?: string;

  @ApiPropertyOptional({ example: '1102', description: 'CFOP que a regra determina' })
  @IsOptional()
  @Transform(trim)
  @Matches(CFOP_PATTERN, { message: 'cfop deve ter 4 dígitos e começar entre 1 e 7' })
  cfop?: string;

  @ApiPropertyOptional({ example: '060', maxLength: 4 })
  @IsOptional()
  @IsString()
  @Length(1, 4)
  @Transform(trim)
  icmsCst?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsPercentage()
  icmsRate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsPercentage()
  icmsBaseReduction?: string;

  @ApiPropertyOptional({ description: 'Condições adicionais avaliadas fora do banco' })
  @IsOptional()
  @IsObject()
  conditions?: Record<string, unknown>;

  @ApiPropertyOptional({ example: '2026-01-01', description: 'Padrão: hoje.' })
  @IsOptional()
  @IsDateOnly()
  effectiveFrom?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsDateOnly()
  effectiveTo?: string;
}

/**
 * Alteração da regra.
 *
 * Os critérios entram aqui porque a regra é cadastro de decisão, e não registro
 * histórico: ela não é referenciada por nota nenhuma. O que ela decidiu no
 * passado está no que foi apurado, não na regra.
 */
export class UpdateTaxRuleDto {
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @Length(2, 120)
  @Transform(trim)
  name?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 999 })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? value : parseInt(value as string, 10)))
  @IsInt()
  @Min(1)
  @Max(999)
  priority?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(upper)
  @Matches(UF_PATTERN, { message: 'originState deve ser uma UF de duas letras' })
  originState?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(upper)
  @Matches(UF_PATTERN, { message: 'destinationState deve ser uma UF de duas letras' })
  destinationState?: string | null;

  @ApiPropertyOptional({ enum: TaxOperationType })
  @IsOptional()
  @IsEnum(TaxOperationType)
  operationType?: TaxOperationType | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  classificationId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  productId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  productCategoryId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @Matches(CFOP_PATTERN, { message: 'cfop deve ter 4 dígitos e começar entre 1 e 7' })
  cfop?: string | null;

  @ApiPropertyOptional({ maxLength: 4 })
  @IsOptional()
  @IsString()
  @Length(1, 4)
  @Transform(trim)
  icmsCst?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsPercentage()
  icmsRate?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsPercentage()
  icmsBaseReduction?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  conditions?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateOnly()
  effectiveFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateOnly()
  effectiveTo?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** Filtros da regra fiscal (RF-091). */
export class QueryTaxRuleDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: TaxOperationType })
  @IsOptional()
  @IsEnum(TaxOperationType)
  operationType?: TaxOperationType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  classificationId?: string;
}

/**
 * Simulação da resolução (RF-091).
 *
 * Responde "que regra decide esta operação, hoje". É consulta: nenhuma nota é
 * alterada, e nenhum tributo declarado é reescrito.
 */
export class ResolveTaxRuleDto {
  @ApiPropertyOptional({ enum: TaxOperationType })
  @IsOptional()
  @IsEnum(TaxOperationType)
  operationType?: TaxOperationType;

  @ApiPropertyOptional({ example: 'SP' })
  @IsOptional()
  @Transform(upper)
  @Matches(UF_PATTERN, { message: 'originState deve ser uma UF de duas letras' })
  originState?: string;

  @ApiPropertyOptional({ example: 'MG' })
  @IsOptional()
  @Transform(upper)
  @Matches(UF_PATTERN, { message: 'destinationState deve ser uma UF de duas letras' })
  destinationState?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  productCategoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  classificationId?: string;

  @ApiPropertyOptional({ description: 'Data da operação. Padrão: hoje.' })
  @IsOptional()
  @IsDateOnly()
  onDate?: string;
}
