import { Injectable, signal } from '@angular/core';

/**
 * Onde a moldura deixa de caber lado a lado (RNF-014 — UI-083).
 *
 * 900px não é um aparelho: é a largura em que a barra lateral de 232px mais uma
 * tabela de listagem param de conviver sem esmagar as colunas. Tablet em pé
 * (768px) e celular ficam abaixo; tablet deitado (1024px) fica acima e continua
 * com o menu fixo.
 */
export const CONSULTA_COMPACTA = '(max-width: 900px)';

/**
 * Largura da janela como sinal (UI-083).
 *
 * O CSS sozinho esconde a barra lateral no celular, mas não resolve o resto: a
 * gaveta precisa nascer fechada, precisa ficar `inert` enquanto está fora da
 * tela e precisa voltar a ser menu normal quando o aparelho gira. Isso é
 * estado, e estado mora aqui — não em `window.innerWidth` lido dentro do
 * template a cada detecção de mudanças.
 *
 * Usa `matchMedia`, não um ouvinte de `resize`: o navegador avisa só quando o
 * limite é cruzado, em vez de a cada pixel arrastado.
 */
@Injectable({ providedIn: 'root' })
export class ViewportService {
  private readonly _compacto = signal(false);

  /** `true` em celular e tablet em pé — onde o menu vira gaveta. */
  readonly compacto = this._compacto.asReadonly();

  constructor() {
    const lista = this.consultar(CONSULTA_COMPACTA);
    if (!lista) return;
    this._compacto.set(lista.matches);
    lista.addEventListener('change', (evento) => this._compacto.set(evento.matches));
  }

  private consultar(consulta: string): MediaQueryList | null {
    try {
      // Ambiente de teste e renderização fora do navegador não têm `matchMedia`;
      // sem ele a aplicação segue no layout largo, que é o padrão seguro.
      return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia(consulta)
        : null;
    } catch {
      return null;
    }
  }
}
