import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { BranchesApiService } from '../core/api/branches-api.service';
import { ConfigurationsApiService } from '../core/api/configurations-api.service';
import { CompanyService } from '../core/company/company.service';
import { PermissionsService } from '../core/authz/permissions.service';

export interface SituacaoConfiguracao {
  filiais: number;
  categorias: number;
  centros: number;
  parametros: number;
}

const VAZIO: SituacaoConfiguracao = { filiais: 0, categorias: 0, centros: 0, parametros: 0 };

/**
 * O que a empresa ativa já tem configurado (RF-006 — UI-079).
 *
 * Uma contagem só, compartilhada pelo assistente e pelo aviso da tela inicial:
 * as duas telas fazem a mesma pergunta, e perguntar duas vezes seria duas
 * rodadas de requisições por visita ao início.
 *
 * Cada listagem vem com `pageSize: 1` — interessa o `total`, não as linhas. Uma
 * coleção que o perfil não pode ler conta como zero e **não** é oferecida para
 * configurar: quem não pode criar categoria não precisa ver o passo de
 * categorias piscando como pendente.
 */
@Injectable({ providedIn: 'root' })
export class OnboardingStatusService {
  private readonly empresa = inject(CompanyService);
  private readonly permissoes = inject(PermissionsService);
  private readonly branches = inject(BranchesApiService);
  private readonly config = inject(ConfigurationsApiService);

  /** Guarda de qual empresa é a contagem: a resposta da anterior não vale para a seguinte. */
  private readonly _dados = signal<{
    empresaId: string | null;
    situacao: SituacaoConfiguracao;
  } | null>(null);
  private readonly _carregando = signal(false);

  readonly situacao = computed(() => {
    const dados = this._dados();
    return dados && dados.empresaId === this.empresa.ativaId() ? dados.situacao : null;
  });
  readonly carregando = this._carregando.asReadonly();

  /** `null` enquanto não se sabe — a tela inicial não deve piscar um aviso falso. */
  readonly pendente = computed(() => {
    const situacao = this.situacao();
    if (!situacao) return null;
    return situacao.categorias === 0 || situacao.centros === 0 || situacao.filiais === 0;
  });

  carregar(): void {
    // A contagem já em mãos vale para as duas telas que a consultam.
    if (this._carregando() || this.situacao() || !this.empresa.ativaId()) return;
    this._carregando.set(true);

    forkJoin({
      filiais: this.total(this.permissoes.pode('branches:READ'), () =>
        this.branches.list({ pageSize: 1 }),
      ),
      categorias: this.total(this.permissoes.pode('categories:READ'), () =>
        this.config.listCategories({ pageSize: 1 }),
      ),
      centros: this.total(this.permissoes.pode('cost-centers:READ'), () =>
        this.config.listCostCenters({ pageSize: 1 }),
      ),
      parametros: this.permissoes.pode('settings:READ')
        ? this.config.listSettings().pipe(
            map((lista) => lista.length),
            catchError(() => of(0)),
          )
        : of(0),
    }).subscribe({
      next: (situacao) => {
        this._dados.set({ empresaId: this.empresa.ativaId(), situacao });
        this._carregando.set(false);
      },
      error: () => {
        // Sem contagem confiável, o assistente mostra tudo como desconhecido em
        // vez de afirmar que falta o que talvez já exista.
        this._dados.set({ empresaId: this.empresa.ativaId(), situacao: VAZIO });
        this._carregando.set(false);
      },
    });
  }

  /** Força a próxima leitura — usado depois que o assistente cria algo. */
  invalidar(): void {
    this._dados.set(null);
    this.carregar();
  }

  private total(
    permitido: boolean,
    consulta: () => Observable<{ total: number }>,
  ): Observable<number> {
    if (!permitido) return of(0);
    return consulta().pipe(
      map((pagina) => pagina.total),
      catchError(() => of(0)),
    );
  }
}
