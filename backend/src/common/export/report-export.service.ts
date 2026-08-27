import { Injectable } from '@nestjs/common';
import { renderCsv } from './csv.renderer';
import { renderPdf } from './pdf.renderer';
import { RenderedReport, ReportDocument, ReportFormat, safeFilename } from './report-document';
import { renderXlsx } from './xlsx.renderer';

const CONTENT_TYPES: Record<ReportFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

/**
 * Renderização do relatório no formato pedido (RF-113).
 *
 * O serviço não consulta nada: recebe o documento já montado e escolhe o
 * renderizador. É o que garante que os três formatos mostrem o mesmo número —
 * eles partem do mesmo `ReportDocument`, e não de três consultas parecidas.
 */
@Injectable()
export class ReportExportService {
  render(document: ReportDocument, format: ReportFormat): RenderedReport {
    const content =
      format === 'csv'
        ? renderCsv(document)
        : format === 'xlsx'
          ? renderXlsx(document)
          : renderPdf(document);

    return {
      format,
      filename: safeFilename(document.title, format),
      contentType: CONTENT_TYPES[format],
      content,
    };
  }
}
