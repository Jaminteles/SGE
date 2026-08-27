import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { JournalLineType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { IsDateOnly } from '../../../common/utils/date-only';
import { IsMoney } from '../../../common/validators/decimal.decorator';
import { MAX_JOURNAL_LINES } from '../accounting.constants';

/**
 * Uma partida do lançamento (RF-081).
 *
 * `amount` trafega como decimal textual: é dinheiro, e ponto flutuante não entra
 * no caminho de nada que vira saldo (RN-012). Uma diferença de centavo aqui não
 * é arredondamento — é um lançamento que o banco recusa por desbalanceado.
 */
export class JournalEntryLineDto {
  @ApiProperty({ description: 'Conta analítica que recebe a partida' })
  @IsUUID()
  accountId!: string;

  @ApiProperty({ enum: JournalLineType })
  @IsEnum(JournalLineType)
  type!: JournalLineType;

  @ApiProperty({ description: 'Valor em decimal textual, maior que zero' })
  @IsMoney()
  amount!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  costCenterId?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  extraHistory?: string;
}

/**
 * Lançamento manual (RF-081/RF-082).
 *
 * Não existe DTO de alteração: o lançamento é imutável depois de gravado
 * (bd/17 §5), e corrigir é estornar e relançar. Um razão em que a linha de
 * ontem pode ser reescrita hoje não sustenta balancete nem DRE.
 */
export class CreateJournalEntryDto {
  @ApiProperty({ description: 'Data do lançamento (YYYY-MM-DD)' })
  @IsDateOnly()
  entryDate!: string;

  @ApiPropertyOptional({
    description: 'Competência (YYYY-MM-DD). Ausente, usa a data do lançamento.',
  })
  @IsOptional()
  @IsDateOnly()
  competenceDate?: string;

  @ApiProperty({ maxLength: 500, description: 'Histórico: o que o lançamento registra' })
  @IsString()
  @Length(3, 500)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  history!: string;

  @ApiProperty({ type: JournalEntryLineDto, isArray: true, minItems: 2 })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(MAX_JOURNAL_LINES)
  @ValidateNested({ each: true })
  @Type(() => JournalEntryLineDto)
  lines!: JournalEntryLineDto[];

  @ApiPropertyOptional({ description: 'Filial a que o lançamento pertence' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ maxLength: 30, description: 'Lote, para agrupar lançamentos' })
  @IsOptional()
  @IsString()
  @Length(1, 30)
  batch?: string;
}

/** Estorno do lançamento (RF-082). O motivo entra no histórico do estorno. */
export class ReverseJournalEntryDto {
  @ApiProperty({ minLength: 5, maxLength: 400 })
  @IsString()
  @Length(5, 400)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  reason!: string;

  @ApiPropertyOptional({
    description:
      'Competência do estorno (YYYY-MM-DD). Ausente, usa a do lançamento estornado — ' +
      'que é o correto quando o período ainda está aberto.',
  })
  @IsOptional()
  @IsDateOnly()
  competenceDate?: string;
}

/** Filtros do diário (RF-081/RF-082). */
export class QueryJournalEntryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Competência inicial (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateOnly()
  from?: string;

  @ApiPropertyOptional({ description: 'Competência final (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateOnly()
  to?: string;

  @ApiPropertyOptional({ description: 'Conta contábil presente em alguma partida' })
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiPropertyOptional({ description: 'Origem: MANUAL, TITULO_BAIXA, ESTORNO...' })
  @IsOptional()
  @IsString()
  @Length(2, 40)
  origin?: string;

  @ApiPropertyOptional({ maxLength: 30 })
  @IsOptional()
  @IsString()
  @Length(1, 30)
  batch?: string;
}
