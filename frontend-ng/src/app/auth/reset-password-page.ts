import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';

import { AuthApiService } from '../core/api/auth-api.service';
import { Alert } from '../ui/alert';
import { ErrorAlert } from '../ui/error-alert';

/** Política de senha do backend (`IsStrongPassword`). */
export const TAMANHO_MINIMO_SENHA = 10;

/**
 * Valida a senha no cliente para dar retorno imediato. **Não substitui** a
 * validação do backend, que é quem decide — aqui é só para o usuário não
 * descobrir o problema depois de uma ida ao servidor.
 */
export function validarSenha(senha: string, confirmacao: string): string | null {
  if (senha.length < TAMANHO_MINIMO_SENHA) {
    return `A senha deve ter ao menos ${TAMANHO_MINIMO_SENHA} caracteres.`;
  }
  if (!/[A-Za-z]/.test(senha)) return 'A senha deve conter ao menos uma letra.';
  if (!/\d/.test(senha)) return 'A senha deve conter ao menos um número.';
  if (senha !== confirmacao) return 'As senhas não conferem.';
  return null;
}

/** Redefinição de senha via token recebido por e-mail (RF-009 / UI-002). */
@Component({
  selector: 'sge-reset-password-page',
  imports: [FormsModule, RouterLink, ButtonModule, InputTextModule, Alert, ErrorAlert],
  styleUrl: './auth-page.scss',
  template: `
    <div class="auth">
      <div class="auth__inner">
        <div class="brand">
          <span class="brand__mark">SGE</span>
          <span class="brand__name">Gestão Empresarial e Financeira</span>
        </div>

        <form class="card auth__card" (ngSubmit)="redefinir()">
          <div class="auth__titulo">
            <h1>Definir nova senha</h1>
            <p>
              Escolha uma senha com ao menos {{ tamanhoMinimo }} caracteres, incluindo letra e
              número.
            </p>
          </div>

          <sge-error-alert [erro]="erro()" />

          @if (mensagem(); as texto) {
            <sge-alert tom="sucesso" titulo="Senha redefinida" [mensagem]="texto" />
          }

          @if (!token()) {
            <sge-alert
              tom="aviso"
              titulo="Link incompleto"
              mensagem="Abra o link exatamente como recebeu no e-mail ou solicite outro."
            />
          }

          <label class="campo">
            <span class="campo__rotulo">Nova senha</span>
            <input
              pInputText
              type="password"
              name="novaSenha"
              autocomplete="new-password"
              required
              [ngModel]="senha()"
              (ngModelChange)="senha.set($event)"
            />
            @if (erroLocal(); as texto) {
              <span class="campo__erro">{{ texto }}</span>
            }
          </label>

          <label class="campo">
            <span class="campo__rotulo">Confirme a nova senha</span>
            <input
              pInputText
              type="password"
              name="confirmacao"
              autocomplete="new-password"
              required
              [ngModel]="confirmacao()"
              (ngModelChange)="confirmacao.set($event)"
            />
          </label>

          <p-button
            type="submit"
            label="Redefinir senha"
            [loading]="enviando()"
            [disabled]="!token()"
            [fluid]="true"
          />

          <a class="auth__link" routerLink="/login">Voltar ao login</a>
        </form>

        <p class="auth__rodape">SGE v1.0 · Sistema de Gestão Empresarial e Financeira</p>
      </div>
    </div>
  `,
})
export class ResetPasswordPage {
  private readonly api = inject(AuthApiService);
  private readonly rota = inject(ActivatedRoute);

  protected readonly tamanhoMinimo = TAMANHO_MINIMO_SENHA;

  protected readonly token = computed(() => this.rota.snapshot.queryParamMap.get('token') ?? '');

  // Signals, não propriedades comuns: em modo zoneless, atribuir a uma
  // propriedade dentro de um callback assíncrono não dispara detecção de
  // mudanças, e os campos ficariam com a senha visível depois de trocada.
  protected readonly senha = signal('');
  protected readonly confirmacao = signal('');

  protected readonly enviando = signal(false);
  protected readonly erro = signal<unknown>(null);
  protected readonly erroLocal = signal<string | null>(null);
  protected readonly mensagem = signal<string | null>(null);

  protected async redefinir(): Promise<void> {
    if (this.enviando() || !this.token()) return;
    this.erro.set(null);

    const invalida = validarSenha(this.senha(), this.confirmacao());
    this.erroLocal.set(invalida);
    if (invalida) return;

    this.enviando.set(true);
    try {
      const resposta = await firstValueFrom(this.api.resetPassword(this.token(), this.senha()));
      this.mensagem.set(resposta.message);
      // A senha não fica em memória depois de trocada.
      this.senha.set('');
      this.confirmacao.set('');
    } catch (erro: unknown) {
      this.erro.set(erro);
    } finally {
      this.enviando.set(false);
    }
  }
}
