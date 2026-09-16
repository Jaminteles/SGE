import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { PasswordModule } from 'primeng/password';

import { ApiError } from '../core/api/errors';
import { AuthService } from '../core/auth/auth.service';

/**
 * Login (UI-002 / RF-008).
 *
 * A versão completa das telas de autenticação (recuperação e redefinição de
 * senha, aviso de expiração) entra no passo seguinte — esta existe agora
 * porque as guardas de rota precisam de um destino real para redirecionar.
 */
@Component({
  selector: 'sge-login-page',
  imports: [FormsModule, RouterLink, ButtonModule, InputTextModule, PasswordModule, MessageModule],
  templateUrl: './login-page.html',
  styleUrl: './auth-page.scss',
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly rota = inject(ActivatedRoute);

  protected readonly email = signal('');
  protected readonly senha = signal('');

  protected readonly enviando = signal(false);
  protected readonly erro = signal<string | null>(null);

  /** `?motivo=inatividade` — posto pelo `SessionActivityService` (UI-089). */
  protected readonly encerradaPorInatividade =
    this.rota.snapshot.queryParamMap.get('motivo') === 'inatividade';

  protected async entrar(): Promise<void> {
    if (this.enviando()) return;
    this.erro.set(null);
    this.enviando.set(true);

    try {
      await this.auth.login(this.email().trim(), this.senha());
      // Volta para onde o usuário tentou ir antes de ser mandado ao login.
      const origem = this.rota.snapshot.queryParamMap.get('origem');
      await this.router.navigateByUrl(origem ?? '/');
    } catch (erro: unknown) {
      this.erro.set(
        erro instanceof ApiError ? erro.message : 'Não foi possível entrar. Tente de novo.',
      );
    } finally {
      this.enviando.set(false);
    }
  }
}
