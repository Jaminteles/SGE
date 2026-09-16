import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';

import { paraCsv } from '../lib/csv';
import { config } from '../lib/config';
import { AuthService } from '../auth/auth.service';
import { SessionActivityService } from '../auth/session-activity.service';
import { celulaSegura, textoSeguro, urlSegura } from './sanitize';

describe('sanitização de conteúdo (UI-089)', () => {
  it('recusa esquema executável no link, inclusive disfarçado', () => {
    expect(urlSegura('https://banco.com.br/extrato')).toBe('https://banco.com.br/extrato');
    expect(urlSegura('mailto:financeiro@empresa.com.br')).toBe('mailto:financeiro@empresa.com.br');
    expect(urlSegura('/bancos/ordens')).toBe('/bancos/ordens');

    expect(urlSegura('javascript:alert(1)')).toBeNull();
    expect(urlSegura('  JavaScript:alert(1)')).toBeNull();
    // Caractere de controle no meio do esquema é como se passa por comparação
    // ingênua: `java\nscript:` vira `javascript:` no navegador.
    expect(urlSegura('java\nscript:alert(1)')).toBeNull();
    expect(urlSegura('data:text/html,<script>alert(1)</script>')).toBeNull();
    // Sem esquema e começando com `//`, herdaria o protocolo e sairia da origem.
    expect(urlSegura('//evil.example.com')).toBeNull();
    expect(urlSegura('')).toBeNull();
    expect(urlSegura(null)).toBeNull();
  });

  it('tira controle e limita o tamanho do texto que sai da tela', () => {
    expect(textoSeguro('linha 1\nlinha 2')).toBe('linha 1 linha 2');
    expect(textoSeguro(null)).toBe('');
    expect(textoSeguro('a'.repeat(900), 100)).toHaveLength(100);
  });

  it('neutraliza fórmula no CSV exportado da listagem', () => {
    // Nome de parceiro é texto digitado por usuário: ao abrir o arquivo, a
    // planilha executaria a fórmula com os dados da célula ao lado.
    expect(celulaSegura('=HYPERLINK("http://x")')).toBe('\'=HYPERLINK("http://x")');
    expect(celulaSegura('Acme LTDA')).toBe('Acme LTDA');

    const csv = paraCsv(
      [{ legalName: '=cmd|/c calc', note: '+55 11 99999-0000' }],
      [
        { campo: 'legalName', cabecalho: 'Razão social' },
        { campo: 'note', cabecalho: 'Observação' },
      ],
    );
    const linha = csv.split('\r\n')[1];
    expect(linha).toBe('"\'=cmd|/c calc";"\'+55 11 99999-0000"');
  });
});

describe('expiração e renovação de sessão (UI-089)', () => {
  function montar(opcoes: { expiraEm: number | null; autenticado?: boolean }) {
    const logout = vi.fn(() => Promise.resolve());
    const renovar = vi.fn(() => Promise.resolve(true));
    const navigate = vi.fn(() => Promise.resolve(true));

    TestBed.configureTestingModule({
      providers: [
        {
          provide: AuthService,
          useValue: {
            autenticado: () => opcoes.autenticado ?? true,
            expiraEm: () => opcoes.expiraEm,
            logout,
            renovar,
          },
        },
        { provide: Router, useValue: { navigate } },
      ],
    });

    return { servico: TestBed.inject(SessionActivityService), logout, renovar, navigate };
  }

  it('renova antes de expirar enquanto o usuário está trabalhando', async () => {
    const { servico, renovar, logout } = montar({
      expiraEm: Date.now() + config.sessionRenewAheadMs / 2,
    });

    await servico.verificar();

    expect(renovar).toHaveBeenCalledTimes(1);
    expect(logout).not.toHaveBeenCalled();
  });

  it('não renova token com folga — só perto da hora', async () => {
    const { servico, renovar } = montar({ expiraEm: Date.now() + 15 * 60 * 1000 });
    await servico.verificar();
    expect(renovar).not.toHaveBeenCalled();
  });

  it('encerra a sessão da tela abandonada e explica o motivo no login', async () => {
    const { servico, logout, navigate, renovar } = montar({ expiraEm: Date.now() + 60_000 });

    // Última interação antes da janela de inatividade.
    (servico as unknown as { ultimaAtividade: number }).ultimaAtividade =
      Date.now() - config.sessionIdleMs - 1;
    await servico.verificar();

    expect(logout).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { motivo: 'inatividade' },
    });
    // Sessão que caiu não se renova.
    expect(renovar).not.toHaveBeenCalled();
  });

  it('não faz nada sem sessão — a tela de login não expira', async () => {
    const { servico, logout, renovar } = montar({ expiraEm: null, autenticado: false });
    (servico as unknown as { ultimaAtividade: number }).ultimaAtividade = 0;
    await servico.verificar();
    expect(logout).not.toHaveBeenCalled();
    expect(renovar).not.toHaveBeenCalled();
  });
});
