import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsUUID, Matches } from 'class-validator';
import { IsDateOnly } from '../../../common/utils/date-only';
import { CFOP_PATTERN } from '../fiscal.constants';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Sentido da operação, projetado de `documento_fiscal.tipo_operacao`. */
export const FISCAL_DIRECTIONS = ['ENTRADA', 'SAIDA'] as const;
export type FiscalDirection = (typeof FISCAL_DIRECTIONS)[number];

/**
 * Recorte da apuração e do livro fiscal (RF-093).
 *
 * O período é obrigatório: relatório fiscal sem período é a base inteira da
 * empresa, e o custo dele cresce com o histórico — a apuração se entrega por
 * competência, e é por competência que se consulta.
 */
export class QueryFiscalReportDto {
  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsDateOnly()
  from!: string;

  @ApiPropertyOptional({ example: '2026-01-31' })
  @IsDateOnly()
  to!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ enum: FISCAL_DIRECTIONS })
  @IsOptional()
  @IsIn(FISCAL_DIRECTIONS)
  direction?: FiscalDirection;
}

/** Livro de entradas e saídas por CFOP (RF-093). */
export class QueryFiscalLedgerDto extends QueryFiscalReportDto {
  @ApiPropertyOptional({ example: '1102' })
  @IsOptional()
  @Transform(trim)
  @Matches(CFOP_PATTERN, { message: 'cfop deve ter 4 dígitos e começar entre 1 e 7' })
  cfop?: string;

  @ApiPropertyOptional({ example: '84713012' })
  @IsOptional()
  @Transform(trim)
  @Matches(/^\d{8}$/, { message: 'ncm deve ter 8 dígitos' })
  ncm?: string;
}
