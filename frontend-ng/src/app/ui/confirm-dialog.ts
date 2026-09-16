import { Component, inject } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';

import { ConfirmService } from './confirm.service';

/**
 * Diálogo único de confirmação (UI-081). Montado uma vez na moldura
 * autenticada; o conteúdo vem do `ConfirmService`.
 *
 * Fechar pelo Esc ou pelo X conta como recusa — o padrão seguro quando a ação
 * do outro lado apaga, inativa ou movimenta dinheiro.
 */
@Component({
  selector: 'sge-confirm-dialog',
  imports: [ButtonModule, DialogModule],
  template: `
    @if (confirmacao.pedido(); as pedido) {
      <p-dialog
        [visible]="true"
        [modal]="true"
        [draggable]="false"
        [resizable]="false"
        [style]="{ width: '30rem' }"
        [header]="pedido.titulo"
        (visibleChange)="confirmacao.responder(false)"
      >
        @if (pedido.mensagem) {
          <p class="confirmacao__mensagem">{{ pedido.mensagem }}</p>
        }
        @if (pedido.detalhes?.length) {
          <ul class="confirmacao__detalhes">
            @for (detalhe of pedido.detalhes; track detalhe) {
              <li>{{ detalhe }}</li>
            }
          </ul>
        }

        <ng-template #footer>
          <p-button
            [label]="pedido.rotuloCancelar ?? 'Cancelar'"
            severity="secondary"
            [text]="true"
            (onClick)="confirmacao.responder(false)"
          />
          <p-button
            [label]="pedido.rotuloConfirmar ?? 'Confirmar'"
            [severity]="pedido.destrutivo ? 'danger' : 'primary'"
            (onClick)="confirmacao.responder(true)"
          />
        </ng-template>
      </p-dialog>
    }
  `,
  styles: `
    .confirmacao__mensagem {
      margin: 0;
      font-size: 0.85rem;
      line-height: 1.5;
      color: var(--p-text-color);
    }
    .confirmacao__detalhes {
      margin: 0.75rem 0 0;
      padding-left: 1.1rem;
      font-size: 0.78rem;
      line-height: 1.6;
      color: var(--p-text-muted-color);
    }
  `,
})
export class ConfirmDialog {
  protected readonly confirmacao = inject(ConfirmService);
}
