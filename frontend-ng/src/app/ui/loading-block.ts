import { Component, input } from '@angular/core';
import { SkeletonModule } from 'primeng/skeleton';

/**
 * Carregamento padrão (UI-081).
 *
 * Esqueleto no lugar de "carregando…": a tela já nasce com a forma que vai ter,
 * então nada salta quando os dados chegam. O `aria-busy` com `role="status"` é
 * o que o leitor de tela anuncia — o esqueleto em si é decorativo.
 */
@Component({
  selector: 'sge-loading-block',
  imports: [SkeletonModule],
  template: `
    <div class="carregando" role="status" aria-busy="true" [attr.aria-label]="rotulo()">
      @for (linha of linhas(); track linha) {
        <p-skeleton height="1.15rem" [width]="linha === 1 ? '45%' : '100%'" />
      }
      <span class="sr-only">{{ rotulo() }}</span>
    </div>
  `,
  styles: `
    .carregando {
      display: flex;
      flex-direction: column;
      gap: 0.65rem;
      padding: 1.125rem;
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }
  `,
})
export class LoadingBlock {
  /** Quantidade de barras do esqueleto. */
  readonly quantidade = input(4);
  readonly rotulo = input('Carregando…');

  protected linhas(): number[] {
    return Array.from({ length: Math.max(1, this.quantidade()) }, (_, i) => i + 1);
  }
}
