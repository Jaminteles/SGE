import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TaxRegime } from '@prisma/client';
import { IsBoolean, IsEnum, IsObject, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { IsDateOnly } from '../../../common/utils/date-only';
import { IsPercentage } from '../../../common/validators/decimal.decorator';

/**
 * Cadastro do parâmetro fiscal (RF-088).
 *
 * As alíquotas trafegam como string decimal (RN-012): são números que entram na
 * apuração, e `number` em JSON é ponto flutuante binário.
 */
export class CreateTaxParameterDto {
  @ApiPropertyOptional({
    description: 'Filial à qual o parâmetro se aplica. Ausente = a empresa inteira.',
  })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiProperty({ enum: TaxRegime })
  @IsEnum(TaxRegime)
  taxRegime!: TaxRegime;

  @ApiProperty({ example: '2026-01-01' })
  @IsDateOnly()
  effectiveFrom!: string;

  @ApiPropertyOptional({
    example: '2026-12-31',
    description: 'Ausente = vigente por prazo indeterminado.',
  })
  @IsOptional()
  @IsDateOnly()
  effectiveTo?: string;

  @ApiPropertyOptional({ description: 'Só no Simples Nacional; recusada nos demais regimes.' })
  @IsOptional()
  @IsPercentage()
  simplesRate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsPercentage()
  issRate?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  ipiTaxpayer?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  taxSubstitute?: boolean;

  @ApiPropertyOptional({ description: 'Parâmetros específicos do município ou do regime.' })
  @IsOptional()
  @IsObject()
  additionalParameters?: Record<string, unknown>;
}

/**
 * Alteração do parâmetro.
 *
 * `branchId` fica de fora: mudar a filial de um parâmetro já vigente move o
 * regime tributário de um estabelecimento para outro retroativamente. O caminho
 * é encerrar a vigência deste e cadastrar o da filial certa.
 */
export class UpdateTaxParameterDto {
  @ApiPropertyOptional({ enum: TaxRegime })
  @IsOptional()
  @IsEnum(TaxRegime)
  taxRegime?: TaxRegime;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateOnly()
  effectiveFrom?: string;

  @ApiPropertyOptional({ description: 'Informe `null` para voltar a prazo indeterminado.' })
  @IsOptional()
  @IsDateOnly()
  effectiveTo?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsPercentage()
  simplesRate?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsPercentage()
  issRate?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  ipiTaxpayer?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  taxSubstitute?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  additionalParameters?: Record<string, unknown>;
}

/**
 * Recorte da resolução do parâmetro vigente (RF-088).
 *
 * Sem paginação de propósito: a resposta é um parâmetro só, ou nenhum — é essa a
 * garantia que a vigência sem sobreposição existe para dar.
 */
export class QueryCurrentTaxParameterDto {
  @ApiPropertyOptional({ description: 'Filial cujo parâmetro tem precedência.' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ example: '2026-08-27', description: 'Padrão: hoje.' })
  @IsOptional()
  @IsDateOnly()
  onDate?: string;
}

/** Filtros do parâmetro fiscal (RF-088). */
export class QueryTaxParameterDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Parâmetros da filial informada' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ enum: TaxRegime })
  @IsOptional()
  @IsEnum(TaxRegime)
  taxRegime?: TaxRegime;

  @ApiPropertyOptional({
    example: '2026-08-27',
    description: 'Só o parâmetro vigente nesta data.',
  })
  @IsOptional()
  @IsDateOnly()
  onDate?: string;
}
