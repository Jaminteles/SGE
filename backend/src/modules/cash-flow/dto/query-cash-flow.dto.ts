import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { IsDateOnly } from '../../../common/utils/date-only';

/**
 * Recorte do fluxo de caixa (RF-101/RF-103).
 *
 * Sem período informado o serviço usa uma janela padrão — nunca "tudo": a
 * carteira inteira somada num número só não responde a nenhuma pergunta de
 * caixa, e é a consulta mais cara que a tabela aceita.
 */
export class QueryCashFlowDto {
  @ApiPropertyOptional({ description: 'Início do período (padrão: hoje)' })
  @IsOptional()
  @IsDateOnly()
  from?: string;

  @ApiPropertyOptional({ description: 'Fim do período (padrão: 90 dias após o início)' })
  @IsOptional()
  @IsDateOnly()
  to?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  costCenterId?: string;
}
