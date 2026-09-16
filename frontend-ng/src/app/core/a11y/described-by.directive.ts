import { Directive, ElementRef, afterRenderEffect, inject, input } from '@angular/core';

/** Onde mora o controle que de fato recebe o foco dentro de um componente do PrimeNG. */
const FOCAVEL = 'input, textarea, select, [role="combobox"], [role="listbox"], [tabindex]';

/**
 * Liga dica e mensagem de erro ao controle real (WCAG 2.1 AA — UI-082).
 *
 * Num `<input>` nosso basta escrever `aria-describedby` no template. Nos campos
 * do PrimeNG (`p-select`, `p-autocomplete`) não dá: o elemento com
 * `role="combobox"` é gerado dentro do componente, e um atributo escrito no
 * `<p-select>` fica no elemento de fora — que o leitor de tela ignora, porque
 * não é ele que tem o papel nem o foco.
 *
 * Esta diretiva procura o controle interno depois da renderização e escreve lá
 * o `aria-describedby` e o `aria-invalid`. Sem isso, o usuário de leitor de tela
 * ouve "Conta contábil, caixa de combinação" e não ouve "Informe a conta" —
 * descobre que errou só quando o formulário recusa o envio (critério 3.3.1).
 */
@Directive({
  selector: '[sgeDescribedBy]',
})
export class DescribedByDirective {
  /** Ids dos elementos que descrevem o campo; vazios são descartados. */
  readonly sgeDescribedBy = input<(string | null)[]>([]);
  /** `true` marca o controle como inválido para a tecnologia assistiva. */
  readonly sgeInvalido = input(false);

  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);

  constructor() {
    afterRenderEffect(() => {
      const ids = this.sgeDescribedBy().filter((id): id is string => !!id);
      const invalido = this.sgeInvalido();

      const raiz = this.host.nativeElement;
      // O próprio host serve quando ele já é o controle (caso do `<input>`).
      const alvo = raiz.matches(FOCAVEL) ? raiz : raiz.querySelector<HTMLElement>(FOCAVEL);
      if (!alvo) return;

      if (ids.length > 0) alvo.setAttribute('aria-describedby', ids.join(' '));
      else alvo.removeAttribute('aria-describedby');

      if (invalido) alvo.setAttribute('aria-invalid', 'true');
      else alvo.removeAttribute('aria-invalid');
    });
  }
}
