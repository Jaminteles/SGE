import { Injectable, signal } from '@angular/core';

export interface PedidoConfirmacao {
  titulo: string;
  mensagem?: string;
  /** Linhas de contexto — o que exatamente será afetado. */
  detalhes?: string[];
  rotuloConfirmar?: string;
  rotuloCancelar?: string;
  /** Pinta o botão de confirmar em vermelho: inativação, cancelamento, estorno. */
  destrutivo?: boolean;
}

/**
 * Confirmação de ação (UI-081).
 *
 * Existe para que toda ação irreversível pergunte do mesmo jeito. O `confirm()`
 * do navegador não serve: não segue o tema, não deixa nomear o botão com o
 * verbo da ação e trava a aba inteira.
 *
 * O serviço só guarda o pedido pendente; quem desenha é o `<sge-confirm-dialog>`
 * montado uma única vez na moldura autenticada. Assim nenhuma página precisa
 * hospedar diálogo próprio.
 */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  private readonly _pedido = signal<PedidoConfirmacao | null>(null);

  readonly pedido = this._pedido.asReadonly();

  private resolver: ((confirmado: boolean) => void) | null = null;

  /**
   * Resolve `true` se o usuário confirmar. Um pedido ainda aberto quando outro
   * chega é resolvido como recusado — nunca fica promessa pendurada.
   */
  confirmar(pedido: PedidoConfirmacao): Promise<boolean> {
    this.responder(false);
    this._pedido.set(pedido);
    return new Promise<boolean>((resolve) => {
      this.resolver = resolve;
    });
  }

  responder(confirmado: boolean): void {
    const resolver = this.resolver;
    this.resolver = null;
    this._pedido.set(null);
    resolver?.(confirmado);
  }
}
