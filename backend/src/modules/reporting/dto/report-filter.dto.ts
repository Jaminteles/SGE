import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { IsDateOnly } from '../../../common/utils/date-only';
import { REPORT_FORMATS, ReportFormat } from '../../../common/export/report-document';
import { REPORT_KEYS, ReportKey } from '../report.constants';

/**
 * Recorte comum a todo painel e todo relatório do M15 (RF-112).
 *
 * O período é obrigatório e não tem padrão. Um dashboard que assume "os últimos
 * 30 dias" quando o filtro vem vazio produz um número que ninguém pediu e que
 * muda sozinho de um dia para o outro — e é justamente o número que alguém vai
 * copiar para uma ata.
 *
 * A empresa **não** está aqui: ela vem do header da requisição e é validada
 * pelo guard. Aceitá-la no corpo do filtro criaria a rota pela qual se lê a
 * empresa do vizinho (IDOR), e a RLS a devolveria vazia de todo jeito.
 *
 * Os demais campos são opcionais e se aplicam onde a dimensão existe: filial,
 * categoria financeira, centro de custo, conta bancária, conta contábil e
 * parceiro. Filtro que não faz sentido na consulta é ignorado por ela, não
 * silenciosamente aplicado a outra coluna.
 */
export class ReportFilterDto {
  @ApiProperty({ example: '2026-01-01', description: 'Início do período (YYYY-MM-DD)' })
  @IsDateOnly()
  from!: string;

  @ApiProperty({ example: '2026-01-31', description: 'Fim do período (YYYY-MM-DD)' })
  @IsDateOnly()
  to!: string;

  @ApiPropertyOptional({ description: 'Filial' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ description: 'Categoria financeira' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ description: 'Centro de custo' })
  @IsOptional()
  @IsUUID()
  costCenterId?: string;

  @ApiPropertyOptional({ description: 'Conta bancária da empresa' })
  @IsOptional()
  @IsUUID()
  bankAccountId?: string;

  @ApiPropertyOptional({ description: 'Parceiro (cliente ou fornecedor)' })
  @IsOptional()
  @IsUUID()
  partnerId?: string;
}

/** Exportação de um relatório do catálogo, no formato pedido (RF-113). */
export class ExportReportDto extends ReportFilterDto {
  @ApiProperty({ enum: REPORT_KEYS, description: 'Relatório do catálogo do M15' })
  @IsIn(REPORT_KEYS)
  report!: ReportKey;

  @ApiProperty({ enum: REPORT_FORMATS })
  @IsIn(REPORT_FORMATS)
  format!: ReportFormat;
}
