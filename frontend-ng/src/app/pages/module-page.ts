import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';

import { StateScreen } from '../ui/state-screen';

/**
 * Espaço reservado de cada módulo. A fundação (Sprint 18) entrega navegação,
 * sessão, empresa ativa e componentes base; as telas de cada módulo entram nas
 * sprints 19 a 24, e já estão desenhadas no Figma.
 */
@Component({
  selector: 'sge-module-page',
  imports: [StateScreen],
  template: `
    <p class="crumb">{{ titulo() }}</p>
    <div class="pagehead">
      <div>
        <h1>{{ titulo() }}</h1>
        <p>Sprint {{ sprint() }} da Fase 9</p>
      </div>
    </div>
    <div class="card">
      <sge-state-screen
        icone="pi-objects-column"
        titulo="Tela em construção"
        mensagem="Você tem acesso a este módulo. As telas serão entregues nas próximas sprints da Fase 9."
      />
    </div>
  `,
})
export class ModulePage {
  private readonly rota = inject(ActivatedRoute);

  private readonly dados = toSignal(this.rota.data, { initialValue: this.rota.snapshot.data });

  protected readonly titulo = () => (this.dados()['titulo'] as string | undefined) ?? 'Módulo';
  protected readonly sprint = () => (this.dados()['sprint'] as string | undefined) ?? '19 a 24';
}
