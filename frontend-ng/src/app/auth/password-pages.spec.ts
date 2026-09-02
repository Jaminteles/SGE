import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';

import { SGE_INTERCEPTORS } from '../core/api/interceptors';
import { ForgotPasswordPage } from './forgot-password-page';
import { ResetPasswordPage, validarSenha } from './reset-password-page';

const BASE = '/api/v1';

function preencher(fixture: ComponentFixture<unknown>, seletor: string, valor: string): void {
  const input = fixture.nativeElement.querySelector(seletor) as HTMLInputElement;
  input.value = valor;
  input.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

function submeter(fixture: ComponentFixture<unknown>): void {
  (fixture.nativeElement.querySelector('form') as HTMLFormElement).requestSubmit();
  fixture.detectChanges();
}

describe('ForgotPasswordPage (RF-009)', () => {
  let fixture: ComponentFixture<ForgotPasswordPage>;
  let mock: HttpTestingController;
  const texto = () => fixture.nativeElement.textContent as string;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ForgotPasswordPage],
      providers: [
        provideHttpClient(withInterceptors(SGE_INTERCEPTORS)),
        provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ForgotPasswordPage);
    mock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  it('envia o e-mail sem espaços em volta', async () => {
    preencher(fixture, 'input[type=email]', '  jamile@empresa.com.br  ');
    submeter(fixture);

    const req = mock.expectOne(`${BASE}/auth/forgot-password`);
    expect(req.request.body).toEqual({ email: 'jamile@empresa.com.br' });
    req.flush({ message: 'Se o e-mail existir, enviaremos um link.' });

    await fixture.whenStable();
    fixture.detectChanges();
    expect(texto()).toContain('Solicitação registrada');
    expect(texto()).toContain('Se o e-mail existir, enviaremos um link.');
  });

  it('não leva token nem empresa: é rota pública', () => {
    preencher(fixture, 'input[type=email]', 'jamile@empresa.com.br');
    submeter(fixture);

    const req = mock.expectOne(`${BASE}/auth/forgot-password`);
    expect(req.request.headers.has('Authorization')).toBe(false);
    expect(req.request.headers.has('x-company-id')).toBe(false);
    req.flush({ message: 'ok' });
  });

  it('mostra o erro da API sem apagar o formulário', async () => {
    preencher(fixture, 'input[type=email]', 'jamile@empresa.com.br');
    submeter(fixture);

    mock
      .expectOne(`${BASE}/auth/forgot-password`)
      .flush(
        { statusCode: 429, error: 'Too Many Requests', message: 'Aguarde antes de tentar de novo.' },
        { status: 429, statusText: 'Too Many Requests' },
      );

    await fixture.whenStable();
    fixture.detectChanges();
    expect(texto()).toContain('Aguarde antes de tentar de novo.');
    const input = fixture.nativeElement.querySelector('input[type=email]') as HTMLInputElement;
    expect(input.value).toBe('jamile@empresa.com.br');
  });
});

describe('validarSenha', () => {
  it('exige o tamanho mínimo da política do backend', () => {
    expect(validarSenha('curta1', 'curta1')).toBe('A senha deve ter ao menos 10 caracteres.');
  });

  it('exige letra e número', () => {
    expect(validarSenha('1234567890', '1234567890')).toBe(
      'A senha deve conter ao menos uma letra.',
    );
    expect(validarSenha('abcdefghij', 'abcdefghij')).toBe(
      'A senha deve conter ao menos um número.',
    );
  });

  it('exige que a confirmação confira', () => {
    expect(validarSenha('senhaBoa123', 'senhaBoa124')).toBe('As senhas não conferem.');
  });

  it('aceita senha dentro da política', () => {
    expect(validarSenha('senhaBoa123', 'senhaBoa123')).toBeNull();
  });
});

describe('ResetPasswordPage (RF-009)', () => {
  let fixture: ComponentFixture<ResetPasswordPage>;
  let mock: HttpTestingController;
  const texto = () => fixture.nativeElement.textContent as string;

  async function montar(token: string | null): Promise<void> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [ResetPasswordPage],
      providers: [
        provideHttpClient(withInterceptors(SGE_INTERCEPTORS)),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParamMap: convertToParamMap(token === null ? {} : { token }),
            },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ResetPasswordPage);
    mock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  }

  it('avisa quando o link veio sem token e desabilita o envio', async () => {
    await montar(null);
    expect(texto()).toContain('Link incompleto');

    const botao = fixture.nativeElement.querySelector('button[type=submit]') as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
  });

  it('não chama a API quando a senha viola a política', async () => {
    await montar('token-abc');
    const [senha, confirmacao] = fixture.nativeElement.querySelectorAll('input[type=password]');
    senha.value = 'curta1';
    senha.dispatchEvent(new Event('input'));
    confirmacao.value = 'curta1';
    confirmacao.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    submeter(fixture);

    mock.expectNone(`${BASE}/auth/reset-password`);
    expect(texto()).toContain('A senha deve ter ao menos 10 caracteres.');
  });

  it('redefine e limpa os campos, para a senha não ficar em memória', async () => {
    await montar('token-abc');
    const [senha, confirmacao] = fixture.nativeElement.querySelectorAll('input[type=password]');
    senha.value = 'senhaBoa123';
    senha.dispatchEvent(new Event('input'));
    confirmacao.value = 'senhaBoa123';
    confirmacao.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    submeter(fixture);

    const req = mock.expectOne(`${BASE}/auth/reset-password`);
    expect(req.request.body).toEqual({ token: 'token-abc', newPassword: 'senhaBoa123' });
    req.flush({ message: 'Senha alterada com sucesso.' });

    // Dois ciclos: o primeiro deixa a resposta resolver e o componente limpar
    // os signals; o segundo deixa o `ngModel` escrever no DOM, o que ele faz
    // numa microtarefa depois da detecção de mudanças.
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto()).toContain('Senha redefinida');
    const campos = fixture.nativeElement.querySelectorAll('input[type=password]');
    expect(campos[0].value).toBe('');
    expect(campos[1].value).toBe('');
  });
});
