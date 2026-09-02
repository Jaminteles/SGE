import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';

import { StateScreen } from '../ui/state-screen';

/**
 * Destino do `permissaoGuard` (UI-004).
 *
 * De novo: é usabilidade, não segurança. Mesmo que alguém force a URL do
 * módulo, cada requisição da tela seria recusada pelo backend.
 */
@Component({
  selector: 'sge-sem-permissao-page',
  imports: [RouterLink, ButtonModule, StateScreen],
  template: `
    <div class="card">
      <sge-state-screen
        icone="pi-lock"
        titulo="Sem permissão no perfil"
        mensagem="Seu perfil nesta empresa não dá acesso a este módulo. Fale com o administrador para solicitar o acesso."
      >
        <p-button label="Voltar ao início" routerLink="/" />
      </sge-state-screen>
    </div>
  `,
})
export class SemPermissaoPage {}
