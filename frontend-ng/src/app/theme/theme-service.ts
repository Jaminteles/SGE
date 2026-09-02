import { Injectable, computed, effect, signal } from '@angular/core';

export type Tema = 'dark' | 'light';

const STORAGE_KEY = 'sge.tema';
/** Mesmo seletor registrado como `darkModeSelector` em app.config.ts. */
const DARK_CLASS = 'sge-dark';

/**
 * Tema da interface (UI-078).
 *
 * O escuro é o padrão do produto: o `index.html` já nasce com a classe, então
 * o app não pisca branco antes do Angular subir. Uma escolha explícita do
 * usuário vence o padrão e sobrevive ao reload.
 *
 * A troca é só a classe no `<html>` — todo o resto sai dos tokens do PrimeNG,
 * que resolvem claro/escuro pela função CSS `light-dark()`.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly _tema = signal<Tema>(this.temaInicial());

  readonly tema = this._tema.asReadonly();
  readonly escuro = computed(() => this._tema() === 'dark');

  constructor() {
    // Um único ponto de escrita: qualquer mudança do sinal reflete no DOM e
    // persiste. Assim não há como a classe e o estado divergirem.
    effect(() => {
      const tema = this._tema();
      document.documentElement.classList.toggle(DARK_CLASS, tema === 'dark');
      this.storage()?.setItem(STORAGE_KEY, tema);
    });
  }

  alternar(): void {
    this._tema.update((tema) => (tema === 'dark' ? 'light' : 'dark'));
  }

  definir(tema: Tema): void {
    this._tema.set(tema);
  }

  private temaInicial(): Tema {
    const salvo = this.storage()?.getItem(STORAGE_KEY);
    return salvo === 'light' ? 'light' : 'dark';
  }

  /** `localStorage` pode lançar (janela anônima, cookies bloqueados). */
  private storage(): Storage | null {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }
}
