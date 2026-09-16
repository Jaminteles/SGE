import { Component, DestroyRef, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
import type { Observable } from 'rxjs';

import { baixarArquivo, nomeComData, paraCsv, type ColunaExportavel } from '../core/lib/csv';

/**
 * Imprimir e exportar a listagem (RF-113 — UI-080).
 *
 * Fica na barra de ferramentas da tabela. A impressão é a da própria tela — o
 * `@media print` global tira a moldura da aplicação e deixa só o conteúdo, sem
 * precisar de rota nem de layout paralelo para papel.
 *
 * O CSV sai do recorte inteiro, não só da página visível: o componente recebe
 * uma consulta (normalmente `ListState.exportar()`) e só monta o arquivo quando
 * ela responde. Enquanto isso o botão fica ocupado — exportar dez páginas leva
 * alguns segundos, e clicar de novo no meio duplicaria o trabalho.
 */
@Component({
  selector: 'sge-print-export',
  imports: [ButtonModule, TooltipModule],
  template: `
    <p-button
      icon="pi pi-print"
      label="Imprimir"
      severity="secondary"
      [text]="true"
      size="small"
      pTooltip="Imprime esta tela, sem o menu e sem a barra superior"
      tooltipPosition="bottom"
      (onClick)="imprimir()"
    />
    @if (consulta()) {
      <p-button
        icon="pi pi-download"
        label="CSV"
        severity="secondary"
        [text]="true"
        size="small"
        [loading]="exportando()"
        pTooltip="Exporta todas as linhas do filtro atual"
        tooltipPosition="bottom"
        (onClick)="exportarCsv()"
      />
    }
    @if (aviso(); as texto) {
      <span class="exportacao__aviso" role="status">{{ texto }}</span>
    }
  `,
  styles: `
    :host {
      display: contents;
    }
    .exportacao__aviso {
      font-size: 0.72rem;
      color: var(--p-text-muted-color);
    }
  `,
})
export class PrintExport {
  /** Prefixo do arquivo: `parceiros` vira `parceiros-2027-09-20.csv`. */
  readonly nome = input('listagem');
  readonly colunas = input<ColunaExportavel[]>([]);
  /**
   * Consulta que devolve o recorte inteiro — normalmente `lista.exportar()`.
   * Ausente numa tela de detalhe: lá só faz sentido imprimir, porque o registro
   * único não vira planilha.
   */
  readonly consulta = input<(() => Observable<{ linhas: unknown[]; truncado: boolean }>) | null>(
    null,
  );

  protected readonly exportando = signal(false);
  protected readonly aviso = signal<string | null>(null);

  private readonly destroyRef = inject(DestroyRef);

  protected imprimir(): void {
    window.print();
  }

  protected exportarCsv(): void {
    const consulta = this.consulta();
    if (!consulta || this.exportando()) return;
    this.exportando.set(true);
    this.aviso.set(null);

    consulta()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ linhas, truncado }) => {
          baixarArquivo(
            nomeComData(this.nome(), 'csv'),
            paraCsv(linhas, this.colunas()),
            'text/csv;charset=utf-8',
          );
          this.exportando.set(false);
          this.aviso.set(
            truncado
              ? `Exportadas as primeiras ${linhas.length} linhas. Refine o filtro ou use os relatórios para o recorte completo.`
              : null,
          );
        },
        error: () => {
          this.exportando.set(false);
          this.aviso.set('Não foi possível exportar agora. Tente de novo em instantes.');
        },
      });
  }
}
