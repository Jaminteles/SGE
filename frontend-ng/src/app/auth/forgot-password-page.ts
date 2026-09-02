import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';

import { AuthApiService } from '../core/api/auth-api.service';
import { Alert } from '../ui/alert';
import { ErrorAlert } from '../ui/error-alert';

/**
 * Recuperação de senha (RF-009 / UI-002).
 *
 * A API responde **sempre a mesma mensagem**, exista ou não o e-mail. A tela
 * não pode revelar quem tem cadastro — seria uma forma de enumerar usuários.
 */
@Component({
  selector: 'sge-forgot-password-page',
  imports: [FormsModule, RouterLink, ButtonModule, InputTextModule, Alert, ErrorAlert],
  styleUrl: './auth-page.scss',
  template: `
    <div class="auth">
      <div class="auth__inner">
        <div class="brand">
          <span class="brand__mark">SGE</span>
          <span class="brand__name">Gestão Empresarial e Financeira</span>
        </div>

        <form class="card auth__card" (ngSubmit)="enviar()">
          <div class="auth__titulo">
            <h1>Recuperar acesso</h1>
            <p>Enviaremos um link de redefinição válido por 30 minutos.</p>
          </div>

          <sge-error-alert [erro]="erro()" />

          @if (mensagem(); as texto) {
            <sge-alert tom="sucesso" titulo="Solicitação registrada" [mensagem]="texto" />
          }

          <label class="campo">
            <span class="campo__rotulo">E-mail cadastrado</span>
            <input
              pInputText
              type="email"
              name="email"
              autocomplete="username"
              placeholder="nome@empresa.com.br"
              required
              [ngModel]="email()"
              (ngModelChange)="email.set($event)"
            />
          </label>

          <p-button type="submit" label="Enviar link" [loading]="enviando()" [fluid]="true" />

          <a class="auth__link" routerLink="/login">Voltar ao login</a>
        </form>

        <p class="auth__rodape">SGE v1.0 · Sistema de Gestão Empresarial e Financeira</p>
      </div>
    </div>
  `,
})
export class ForgotPasswordPage {
  private readonly api = inject(AuthApiService);

  protected readonly email = signal('');
  protected readonly enviando = signal(false);
  protected readonly erro = signal<unknown>(null);
  protected readonly mensagem = signal<string | null>(null);

  protected async enviar(): Promise<void> {
    if (this.enviando()) return;
    this.erro.set(null);
    this.enviando.set(true);
    try {
      const resposta = await firstValueFrom(this.api.forgotPassword(this.email().trim()));
      this.mensagem.set(resposta.message);
    } catch (erro: unknown) {
      this.erro.set(erro);
    } finally {
      this.enviando.set(false);
    }
  }
}
