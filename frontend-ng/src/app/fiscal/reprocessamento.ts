import { Observable, catchError, concatMap, from, map, of, reduce } from 'rxjs';

import type { FiscalDocumentsApiService } from '../core/api/fiscal-documents-api.service';
import { errorMessage } from '../core/api/errors';

export interface ResumoReprocessamento {
  /** Fecharam e ficaram PROCESSADO. */
  processados: number;
  /** Releram o XML e continuam em ERRO — o motivo novo está no documento. */
  comErro: number;
  /** A API recusou (situação mudou, sem XML, sem permissão…). */
  falhas: string[];
}

/**
 * Reprocessa documentos um de cada vez (RF-049 — UI-041).
 *
 * Em série de propósito: cada reprocessamento relê um XML de até 2 MB e
 * reescreve os itens numa transação; disparar a página inteira em paralelo só
 * disputaria conexão e trava. A falha de um não interrompe os demais.
 */
export function reprocessarEmSerie(
  api: FiscalDocumentsApiService,
  documentos: { id: string; number: string }[],
): Observable<ResumoReprocessamento> {
  const inicial: ResumoReprocessamento = { processados: 0, comErro: 0, falhas: [] };

  return from(documentos).pipe(
    concatMap((documento) =>
      api.reprocess(documento.id).pipe(
        map((resultado) => ({ ok: resultado.outcome === 'IMPORTADO', falha: null })),
        catchError((erro: unknown) =>
          of({ ok: false, falha: `${documento.number}: ${errorMessage(erro)}` }),
        ),
      ),
    ),
    reduce((resumo, passo) => {
      if (passo.falha) return { ...resumo, falhas: [...resumo.falhas, passo.falha] };
      return passo.ok
        ? { ...resumo, processados: resumo.processados + 1 }
        : { ...resumo, comErro: resumo.comErro + 1 };
    }, inicial),
  );
}

export function descreverResumo(resumo: ResumoReprocessamento): string {
  const partes = [];
  if (resumo.processados) partes.push(`${resumo.processados} processado(s)`);
  if (resumo.comErro) partes.push(`${resumo.comErro} continua(m) com erro`);
  if (resumo.falhas.length) partes.push(`${resumo.falhas.length} recusado(s)`);
  return partes.length ? `Reprocessamento concluído: ${partes.join(', ')}.` : 'Nada a reprocessar.';
}
