import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AUDIT_ENTITY, AuditService } from '../../common/audit/audit.service';
import { formatDateOnly, toDateOnly } from '../../common/utils/date-only';
import { PrismaService } from '../../prisma/prisma.service';
import { ExportAccountingDto } from './dto/accounting-report.dto';

/** Teto de lançamentos por exportação. Acima disso, exporte por competência. */
const MAX_EXPORT_ENTRIES = 20_000;

/** Uma partida achatada, como o arquivo a entrega. */
interface ExportRow {
  lancamento: number;
  data_lancamento: string;
  data_competencia: string;
  historico: string;
  origem: string;
  sequencia: number;
  conta_codigo: string;
  conta_nome: string;
  conta_referencial_sped: string;
  tipo: string;
  valor: string;
  centro_custo: string;
}

export interface AccountingExportResult {
  format: 'csv' | 'json';
  filename: string;
  contentType: string;
  content: string;
  entries: number;
  lines: number;
  marked: number;
}

/**
 * Exportação e integração contábil (RF-087).
 *
 * O arquivo sai no grão da **partida**, não do lançamento: é assim que qualquer
 * sistema contábil importa, e um CSV com partidas aninhadas não existe.
 *
 * Duas decisões:
 *
 *  1. **marcar como exportado é opcional e explícito**. Conferir o lote antes de
 *     assumir que ele foi entregue é o uso normal; marcar sem querer faria os
 *     lançamentos sumirem do próximo `pendingOnly`, e ninguém procura o que
 *     acredita já ter mandado;
 *  2. **exportar não trava nada**. O lançamento exportado continua estornável —
 *     o que muda é que o estorno também precisará ser exportado. Bloquear o
 *     estorno depois da exportação obrigaria a corrigir fora do sistema.
 *
 * Valores saem como decimal textual com duas casas, direto do `Decimal`: um
 * arquivo contábil com `1.1000000000000001` é rejeitado na importação, e um com
 * separador de milhar é pior — importa errado em silêncio.
 */
@Injectable()
export class AccountingExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async export(
    companyId: string,
    dto: ExportAccountingDto,
    userId: string,
  ): Promise<AccountingExportResult> {
    const from = toDateOnly(dto.from);
    const to = toDateOnly(dto.to);
    if (to.getTime() < from.getTime()) {
      throw new BadRequestException('`to` não pode ser anterior a `from`.');
    }

    const where: Prisma.JournalEntryWhereInput = {
      companyId,
      competenceDate: { gte: from, lte: to },
      ...(dto.pendingOnly ? { exported: false } : {}),
    };

    const entries = await this.prisma.db.journalEntry.findMany({
      where,
      orderBy: [{ competenceDate: 'asc' }, { number: 'asc' }],
      take: MAX_EXPORT_ENTRIES + 1,
      select: {
        id: true,
        number: true,
        entryDate: true,
        competenceDate: true,
        history: true,
        origin: true,
        lines: {
          orderBy: { sequence: 'asc' },
          select: {
            sequence: true,
            type: true,
            amount: true,
            extraHistory: true,
            account: { select: { code: true, name: true, spedReferenceCode: true } },
            costCenterId: true,
          },
        },
      },
    });

    if (entries.length > MAX_EXPORT_ENTRIES) {
      throw new BadRequestException(
        `A janela tem mais de ${MAX_EXPORT_ENTRIES} lançamentos. Exporte por competência menor.`,
      );
    }

    const rows: ExportRow[] = [];
    for (const entry of entries) {
      for (const line of entry.lines) {
        rows.push({
          lancamento: Number(entry.number),
          data_lancamento: formatDateOnly(entry.entryDate),
          data_competencia: formatDateOnly(entry.competenceDate),
          historico: line.extraHistory ?? entry.history,
          origem: entry.origin ?? '',
          sequencia: line.sequence,
          conta_codigo: line.account.code,
          conta_nome: line.account.name,
          conta_referencial_sped: line.account.spedReferenceCode ?? '',
          tipo: line.type,
          valor: line.amount.toFixed(2),
          centro_custo: line.costCenterId ?? '',
        });
      }
    }

    let marked = 0;
    if (dto.markExported && entries.length > 0) {
      const { count } = await this.prisma.db.journalEntry.updateMany({
        where: { id: { in: entries.map((entry) => entry.id) }, exported: false },
        data: { exported: true, exportedAt: new Date() },
      });
      marked = count;
    }

    await this.audit.record({
      event: 'EXPORTACAO',
      entity: AUDIT_ENTITY.JOURNAL_ENTRY,
      userId,
      note:
        `Exportação contábil ${dto.from}..${dto.to}: ${entries.length} lançamentos, ` +
        `${rows.length} partidas${dto.markExported ? `, ${marked} marcados` : ''}.`,
    });

    const format = dto.format ?? 'csv';
    return {
      format,
      filename: `contabilidade_${dto.from}_${dto.to}.${format}`,
      contentType: format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json',
      content: format === 'csv' ? this.toCsv(rows) : JSON.stringify(rows),
      entries: entries.length,
      lines: rows.length,
      marked,
    };
  }

  /**
   * CSV com separador `;` e aspas duplicadas.
   *
   * `;` porque é o que a planilha em português espera, e o valor decimal usa
   * ponto — com `,` de separador, todo valor quebraria em duas colunas.
   */
  private toCsv(rows: ExportRow[]): string {
    const header = [
      'lancamento',
      'data_lancamento',
      'data_competencia',
      'historico',
      'origem',
      'sequencia',
      'conta_codigo',
      'conta_nome',
      'conta_referencial_sped',
      'tipo',
      'valor',
      'centro_custo',
    ];

    const lines = rows.map((row) =>
      header.map((column) => this.escape(row[column as keyof ExportRow])).join(';'),
    );

    return [header.join(';'), ...lines].join('\n');
  }

  /**
   * Escapa o campo.
   *
   * O prefixo em `=`, `+`, `-` e `@` é neutralizado: o histórico é texto
   * digitado por usuário, e uma planilha trata `=CMD(...)` como fórmula ao
   * abrir o arquivo (CSV injection).
   */
  private escape(value: string | number): string {
    const text = String(value);
    const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  }
}
