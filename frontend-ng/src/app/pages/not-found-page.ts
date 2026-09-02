import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';

import { StateScreen } from '../ui/state-screen';

@Component({
  selector: 'sge-not-found-page',
  imports: [RouterLink, ButtonModule, StateScreen],
  template: `
    <div class="card">
      <sge-state-screen
        icone="pi-compass"
        titulo="Página não encontrada"
        mensagem="O endereço acessado não existe nesta área do sistema."
      >
        <p-button label="Voltar ao início" routerLink="/" />
      </sge-state-screen>
    </div>
  `,
})
export class NotFoundPage {}
