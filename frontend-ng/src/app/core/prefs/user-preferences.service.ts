import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';

import { AuthService } from '../auth/auth.service';
import { CompanyService } from '../company/company.service';
import { ThemeService, type Tema } from '../../theme/theme-service';
import type { ValoresFiltro } from '../../ui/filter-bar';

export type Densidade = 'confortavel' | 'compacta';

/** Recorte de filtros nomeado pelo usuário, preso a uma tela e a uma empresa. */
export interface FiltroSalvo {
  id: string;
  /** Tela onde o recorte faz sentido — ex.: `cadastros.parceiros`. */
  chave: string;
  nome: string;
  /** Um filtro guarda ids (categoria, conta, filial) que só valem na empresa em que foi salvo. */
  empresaId: string | null;
  valores: ValoresFiltro;
}

export interface Preferencias {
  densidade: Densidade;
  /** Colunas escondidas por tabela: chave da tabela -> campos ocultos. */
  colunasOcultas: Record<string, string[]>;
  filtros: FiltroSalvo[];
}

const PADRAO: Preferencias = { densidade: 'confortavel', colunasOcultas: {}, filtros: [] };

const PREFIXO = 'sge.preferencias.';
/** Mesma ideia do `.sge-dark`: uma classe no `<html>`, o resto sai do CSS. */
const CLASSE_COMPACTA = 'sge-compacto';

/**
 * Preferências de interface do usuário (UI-078).
 *
 * Tema, densidade, colunas visíveis e filtros salvos. Ficam no `localStorage`,
 * por usuário: numa máquina compartilhada — recepção, financeiro — a escolha de
 * um não pode virar a tela do outro.
 *
 * Não são dados do domínio e não vão para a API: nenhuma decisão de negócio
 * depende delas, e um filtro salvo continua sendo filtro de consulta, aplicado
 * pelo servidor com a RLS da empresa ativa. O tema mora no `ThemeService`, que
 * já era a única fonte da classe no `<html>`; aqui ele é só reexposto para a
 * tela de preferências não precisar de dois serviços.
 */
@Injectable({ providedIn: 'root' })
export class UserPreferencesService {
  private readonly auth = inject(AuthService);
  private readonly empresa = inject(CompanyService);
  private readonly tema = inject(ThemeService);

  private readonly _prefs = signal<Preferencias>(PADRAO);

  readonly prefs = this._prefs.asReadonly();
  readonly densidade = computed(() => this._prefs().densidade);
  readonly compacta = computed(() => this.densidade() === 'compacta');
  readonly temaAtual = this.tema.tema;

  /** Chave por usuário; sem sessão, um balde anônimo que some no login. */
  private readonly chave = computed(() => PREFIXO + (this.auth.usuario()?.id ?? 'anonimo'));

  constructor() {
    // Troca de usuário recarrega tudo do zero — inclusive ao sair.
    effect(() => {
      const chave = this.chave();
      untracked(() => this._prefs.set(this.ler(chave)));
    });

    effect(() => {
      const prefs = this._prefs();
      document.documentElement.classList.toggle(CLASSE_COMPACTA, prefs.densidade === 'compacta');
      this.gravar(untracked(this.chave), prefs);
    });
  }

  definirTema(tema: Tema): void {
    this.tema.definir(tema);
  }

  definirDensidade(densidade: Densidade): void {
    this._prefs.update((prefs) => ({ ...prefs, densidade }));
  }

  // ---------- Colunas visíveis ----------

  /** Campos escondidos na tabela `chave`. */
  colunasOcultas(chave: string): string[] {
    return this._prefs().colunasOcultas[chave] ?? [];
  }

  definirColunasOcultas(chave: string, campos: string[]): void {
    this._prefs.update((prefs) => {
      const colunasOcultas = { ...prefs.colunasOcultas };
      if (campos.length === 0) delete colunasOcultas[chave];
      else colunasOcultas[chave] = [...campos];
      return { ...prefs, colunasOcultas };
    });
  }

  /** Devolve todas as colunas de todas as tabelas (botão "restaurar" da tela de preferências). */
  restaurarColunas(): void {
    this._prefs.update((prefs) => ({ ...prefs, colunasOcultas: {} }));
  }

  // ---------- Filtros salvos ----------

  /** Recortes da tela, apenas os salvos na empresa ativa. */
  filtrosDe(chave: string): FiltroSalvo[] {
    const empresaId = this.empresa.ativaId();
    return this._prefs().filtros.filter(
      (filtro) => filtro.chave === chave && filtro.empresaId === empresaId,
    );
  }

  /** Salva (ou substitui, quando o nome se repete na mesma tela) um recorte. */
  salvarFiltro(chave: string, nome: string, valores: ValoresFiltro): FiltroSalvo {
    const empresaId = this.empresa.ativaId();
    const limpo = nome.trim();
    const novo: FiltroSalvo = {
      id: `${chave}:${empresaId ?? 'sem-empresa'}:${limpo.toLowerCase()}`,
      chave,
      nome: limpo,
      empresaId,
      valores: { ...valores },
    };

    this._prefs.update((prefs) => ({
      ...prefs,
      filtros: [...prefs.filtros.filter((filtro) => filtro.id !== novo.id), novo],
    }));
    return novo;
  }

  removerFiltro(id: string): void {
    this._prefs.update((prefs) => ({
      ...prefs,
      filtros: prefs.filtros.filter((filtro) => filtro.id !== id),
    }));
  }

  readonly todosOsFiltros = computed(() => this._prefs().filtros);

  // ---------- Persistência ----------

  private ler(chave: string): Preferencias {
    const bruto = this.storage()?.getItem(chave);
    if (!bruto) return PADRAO;
    try {
      const salvo = JSON.parse(bruto) as Partial<Preferencias>;
      return {
        densidade: salvo.densidade === 'compacta' ? 'compacta' : 'confortavel',
        // O formato pode ter mudado entre versões: qualquer coisa fora do
        // esperado volta ao padrão em vez de derrubar a aplicação inteira.
        colunasOcultas: this.ehMapaDeColunas(salvo.colunasOcultas) ? salvo.colunasOcultas : {},
        filtros: Array.isArray(salvo.filtros) ? salvo.filtros.filter(ehFiltroSalvo) : [],
      };
    } catch {
      return PADRAO;
    }
  }

  private gravar(chave: string, prefs: Preferencias): void {
    try {
      this.storage()?.setItem(chave, JSON.stringify(prefs));
    } catch {
      // Cota estourada ou armazenamento bloqueado: a preferência vale só nesta
      // sessão. Não é motivo para interromper o que o usuário está fazendo.
    }
  }

  private ehMapaDeColunas(valor: unknown): valor is Record<string, string[]> {
    return (
      typeof valor === 'object' &&
      valor !== null &&
      !Array.isArray(valor) &&
      Object.values(valor).every(
        (campos) => Array.isArray(campos) && campos.every((c) => typeof c === 'string'),
      )
    );
  }

  private storage(): Storage | null {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }
}

function ehFiltroSalvo(valor: unknown): valor is FiltroSalvo {
  const filtro = valor as Partial<FiltroSalvo> | null;
  return (
    typeof filtro?.id === 'string' &&
    typeof filtro.chave === 'string' &&
    typeof filtro.nome === 'string' &&
    typeof filtro.valores === 'object' &&
    filtro.valores !== null
  );
}
