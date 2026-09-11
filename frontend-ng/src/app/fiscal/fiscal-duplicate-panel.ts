import { Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';

import { FiscalDocumentsApiService } from '../core/api/fiscal-documents-api.service';
import type { FiscalDocument } from '../core/api/types';
import { formatCurrency } from '../core/lib/decimal';
import { formatDateTime } from '../core/lib/format';
import { Alert } from '../ui/alert';
import { ErrorAlert } from '../ui/error-alert';
import { ROTULO_ORIGEM, ROTULO_STATUS_NOTA, emitente, formatarDocumento, numeroNota } from './rotulos';

export interface LinhaComparacao {
  campo: string;
  duplicata: string;
  original: string;
  difere: boolean;
}

/**
 * Lado a lado do que identifica e do que vale na nota. É o que a pessoa precisa
 * ver para decidir se a segunda chegada é reenvio alterado, reemissão ou erro.
 */
export function compararDocumentos(
  duplicata: FiscalDocument,
  original: FiscalDocument,
): LinhaComparacao[] {
  const linha = (campo: string, a: string, b: string): LinhaComparacao => ({
    campo,
    duplicata: a,
    original: b,
    difere: a !== b,
  });
  return [
    linha('Número / série', numeroNota(duplicata), numeroNota(original)),
    linha('Emissão', formatDateTime(duplicata.issuedAt), formatDateTime(original.issuedAt)),
    linha('Emitente', emitente(duplicata), emitente(original)),
    linha(
      'CNPJ / CPF do emitente',
      formatarDocumento(duplicata.issuerTaxId),
      formatarDocumento(original.issuerTaxId),
    ),
    linha('Valor total', formatCurrency(duplicata.totalAmount), formatCurrency(original.totalAmount)),
    linha('Itens', String(duplicata.items.length), String(original.items.length)),
    linha('Situação', ROTULO_STATUS_NOTA[duplicata.status], ROTULO_STATUS_NOTA[original.status]),
    linha('Origem', ROTULO_ORIGEM[duplicata.origin], ROTULO_ORIGEM[original.origin]),
    linha('Chegou em', formatDateTime(duplicata.createdAt), formatDateTime(original.createdAt)),
  ];
}

/**
 * Alerta de documento duplicado e resolução pelo usuário (RF-046 — UI-038).
 *
 * A duplicata convive com o original (bd/12): foi registrada para ser vista e
 * não gera estoque nem título. A resolução é decidir, com os dois lado a lado,
 * e descartar a duplicata com o motivo — a única transição que o banco aceita
 * a partir de DUPLICADO.
 */
@Component({
  selector: 'sge-fiscal-duplicate-panel',
  imports: [RouterLink, ButtonModule, Alert, ErrorAlert],
  template: `
    <div class="espaco">
      <sge-alert
        tom="aviso"
        titulo="Documento duplicado"
        [mensagem]="mensagem()"
      />
    </div>

    <section class="card secao espaco">
      <div class="cabeca">
        <h2 class="secao__titulo">Comparação com o original</h2>
        <div class="acoes-cabeca">
          @if (nota().duplicateOf; as original) {
            <p-button
              label="Abrir original"
              severity="secondary"
              [outlined]="true"
              size="small"
              [routerLink]="['/fiscal/documentos', original.id]"
            />
          }
          @if (podeDescartar()) {
            <p-button
              label="Descartar duplicata"
              severity="danger"
              size="small"
              (onClick)="descartar.emit(motivoSugerido())"
            />
          }
        </div>
      </div>

      @if (erro(); as falha) {
        <sge-error-alert [erro]="falha" />
      } @else if (comparacao().length === 0) {
        <p class="secundario">Carregando o original…</p>
      } @else {
        <table class="tabela">
          <thead>
            <tr>
              <th scope="col">Campo</th>
              <th scope="col">Esta duplicata</th>
              <th scope="col">Original</th>
            </tr>
          </thead>
          <tbody>
            @for (linha of comparacao(); track linha.campo) {
              <tr [class.difere]="linha.difere">
                <th scope="row">{{ linha.campo }}</th>
                <td>{{ linha.duplicata }}</td>
                <td>{{ linha.original }}</td>
              </tr>
            }
          </tbody>
        </table>
        <p class="secundario">Linhas destacadas diferem entre os dois documentos.</p>
      }
    </section>
  `,
  styles: `
    .cabeca {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.75rem;
    }
    .cabeca .secao__titulo {
      margin: 0;
    }
    .acoes-cabeca {
      display: flex;
      gap: 0.4rem;
    }
    .tabela {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.8rem;
    }
    .tabela th,
    .tabela td {
      padding: 0.45rem 0.6rem;
      text-align: left;
      border-bottom: 1px solid var(--p-content-border-color);
    }
    .tabela thead th,
    .tabela tbody th {
      color: var(--p-text-muted-color);
      font-weight: 500;
    }
    .difere td {
      font-weight: 600;
      background: color-mix(in srgb, var(--p-yellow-500, #eab308) 12%, transparent);
    }
    .secundario {
      margin: 0.5rem 0 0;
      font-size: 0.75rem;
      color: var(--p-text-muted-color);
    }
  `,
})
export class FiscalDuplicatePanel {
  private readonly api = inject(FiscalDocumentsApiService);
  private readonly destroyRef = inject(DestroyRef);

  readonly nota = input.required<FiscalDocument>();
  readonly podeDescartar = input(false);
  /** Pede o descarte ao detalhe, com o motivo já sugerido. */
  readonly descartar = output<string>();

  protected readonly original = signal<FiscalDocument | null>(null);
  protected readonly erro = signal<unknown>(null);

  protected readonly comparacao = computed(() => {
    const original = this.original();
    return original ? compararDocumentos(this.nota(), original) : [];
  });

  protected readonly mensagem = computed(() => {
    const numero = this.nota().duplicateOf?.number ?? '—';
    return (
      `A mesma chave de acesso já foi importada no documento ${numero}, com conteúdo diferente (RF-046). ` +
      'Esta duplicata não gera estoque nem título: compare com o original e descarte-a informando o motivo. ' +
      'Se o conteúdo correto for o desta, trate a correção com o fornecedor antes de gerar qualquer efeito.'
    );
  });

  protected readonly motivoSugerido = computed(() => {
    const numero = this.nota().duplicateOf?.number ?? '';
    return `Duplicata do documento ${numero}; mantido o original.`;
  });

  constructor() {
    effect(() => {
      const originalId = this.nota().duplicateOf?.id;
      untracked(() => this.carregarOriginal(originalId));
    });
  }

  private carregarOriginal(id: string | undefined): void {
    if (!id || this.original()?.id === id) return;
    this.erro.set(null);
    this.api
      .get(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (registro) => this.original.set(registro),
        error: (falha: unknown) => this.erro.set(falha),
      });
  }
}
