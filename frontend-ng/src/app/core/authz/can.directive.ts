import {
  Directive,
  TemplateRef,
  ViewContainerRef,
  computed,
  effect,
  inject,
  input,
} from '@angular/core';

import type { PermissionCheck } from './permissions';
import { PermissionsService } from './permissions.service';

/** Um código, uma lista (exige todos) ou a forma composta `{ all, any }`. */
export type EntradaPermissao = string | string[] | PermissionCheck;

function normalizar(entrada: EntradaPermissao): PermissionCheck {
  if (typeof entrada === 'string') return { all: [entrada] };
  if (Array.isArray(entrada)) return { all: entrada };
  return entrada;
}

/**
 * Esconde um trecho da interface quando o perfil não tem a permissão (UI-004).
 * Substitui o componente `<Can>` do projeto React.
 *
 * ```html
 * <button *sgeCan="'partners:CREATE'">Novo parceiro</button>
 * <button *sgeCan="{ any: ['stock:READ', 'inventories:READ'] }">Estoque</button>
 * <div *sgeCan="'audit:READ'; else semAcesso">…</div>
 * <ng-template #semAcesso>Sem permissão no perfil</ng-template>
 * ```
 *
 * É conveniência visual: a API recusa a operação de qualquer forma.
 */
@Directive({ selector: '[sgeCan]' })
export class CanDirective {
  private readonly template = inject(TemplateRef<unknown>);
  private readonly container = inject(ViewContainerRef);
  private readonly permissoes = inject(PermissionsService);

  readonly sgeCan = input.required<EntradaPermissao>();
  /** Conteúdo alternativo quando o perfil não tem a permissão. */
  readonly sgeCanElse = input<TemplateRef<unknown> | null>(null);

  private readonly permitido = computed(() => this.permissoes.permite(normalizar(this.sgeCan())));

  /** Evita destruir e recriar a view a cada avaliação — só troca quando muda. */
  private exibindo: 'principal' | 'alternativo' | 'nenhum' = 'nenhum';

  constructor() {
    effect(() => {
      const alvo: typeof this.exibindo = this.permitido()
        ? 'principal'
        : this.sgeCanElse()
          ? 'alternativo'
          : 'nenhum';

      if (alvo === this.exibindo) return;

      this.container.clear();
      if (alvo === 'principal') {
        this.container.createEmbeddedView(this.template);
      } else if (alvo === 'alternativo') {
        this.container.createEmbeddedView(this.sgeCanElse()!);
      }
      this.exibindo = alvo;
    });
  }
}
