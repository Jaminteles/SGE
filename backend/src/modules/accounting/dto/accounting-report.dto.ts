import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { IsDateOnly } from '../../../common/utils/date-only';

/** Recorte de competência comum aos três relatórios (RF-083 a RF-085). */
export class AccountingPeriodRangeDto {
  @ApiProperty({ description: 'Competência inicial (YYYY-MM-DD)' })
  @IsDateOnly()
  from!: string;

  @ApiProperty({ description: 'Competência final (YYYY-MM-DD)' })
  @IsDateOnly()
  to!: string;
}

/**
 * Recorte opcional por centro de custo (RF-083/RF-084 — UI-057).
 *
 * O centro de custo mora na partida, não no lançamento: um mesmo lançamento
 * pode ratear a despesa entre dois centros, e o filtro soma só a fatia de cada
 * um. Saldo anterior e movimento usam o mesmo recorte — senão o saldo final
 * misturaria o centro pedido com o resto da empresa.
 */
export class CostCenterScopeDto extends AccountingPeriodRangeDto {
  @ApiPropertyOptional({ description: 'Só as partidas deste centro de custo' })
  @IsOptional()
  @IsUUID()
  costCenterId?: string;
}

/** Razão de uma conta (RF-083). */
export class QueryLedgerDto extends CostCenterScopeDto {
  @ApiProperty({ description: 'Conta analítica cujo razão se quer ver' })
  @IsUUID()
  accountId!: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 500, default: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

/** Balancete de verificação (RF-084). */
export class QueryTrialBalanceDto extends CostCenterScopeDto {
  @ApiPropertyOptional({
    default: false,
    description: 'Inclui contas sem movimento e sem saldo anterior',
  })
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  includeZeroed?: boolean;
}

/** DRE do período (RF-085). */
export class QueryIncomeStatementDto extends AccountingPeriodRangeDto {}

/** Exportação contábil (RF-087). */
export class ExportAccountingDto extends AccountingPeriodRangeDto {
  @ApiPropertyOptional({ enum: ['csv', 'json'], default: 'csv' })
  @IsOptional()
  @IsIn(['csv', 'json'])
  format?: 'csv' | 'json';

  @ApiPropertyOptional({
    default: false,
    description:
      'Marca os lançamentos como exportados. Sem isto a exportação é só leitura — ' +
      'útil para conferir antes de assumir que o lote foi entregue.',
  })
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  markExported?: boolean;

  @ApiPropertyOptional({ default: false, description: 'Só o que ainda não foi exportado' })
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  pendingOnly?: boolean;
}
