import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { QueryCashFlowDto } from './query-cash-flow.dto';

/** Grão da projeção (RF-102). Todos derivam do dia agregado em `bd/10`. */
export enum CashFlowGranularity {
  DIA = 'DIA',
  SEMANA = 'SEMANA',
  MES = 'MES',
}

/** Projeção do fluxo por período, opcionalmente sob um cenário (RF-102/RF-104). */
export class QueryProjectionDto extends QueryCashFlowDto {
  @ApiPropertyOptional({ enum: CashFlowGranularity, default: CashFlowGranularity.MES })
  @IsOptional()
  @IsEnum(CashFlowGranularity)
  granularity: CashFlowGranularity = CashFlowGranularity.MES;

  @ApiPropertyOptional({
    description:
      'Projeta sob um cenário: usa a janela, o saldo inicial, as premissas e as projeções manuais dele',
  })
  @IsOptional()
  @IsUUID()
  scenarioId?: string;
}
