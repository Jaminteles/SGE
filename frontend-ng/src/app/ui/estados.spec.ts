import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { ApiError } from '../core/api/errors';
import { AsyncState } from './async-state';
import { ConfirmService } from './confirm.service';

describe('AsyncState (UI-081)', () => {
  @Component({
    imports: [AsyncState],
    template: `
      <sge-async-state
        [carregando]="carregando()"
        [erro]="erro()"
        [vazio]="vazio()"
        [filtrado]="filtrado()"
        titulo="Nenhum parceiro cadastrado"
        tituloFiltrado="Nenhum parceiro para esses filtros"
      >
        <p class="conteudo">tabela</p>
      </sge-async-state>
    `,
  })
  class Hospedeiro {
    readonly carregando = signal(false);
    readonly erro = signal<unknown>(null);
    readonly vazio = signal(false);
    readonly filtrado = signal(false);
  }

  function montar() {
    const fixture = TestBed.createComponent(Hospedeiro);
    fixture.detectChanges();
    return fixture;
  }

  it('mostra o esqueleto e esconde o conteúdo enquanto carrega', () => {
    const fixture = montar();
    fixture.componentInstance.carregando.set(true);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="status"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.conteudo')).toBeNull();
  });

  it('erro tem precedência sobre o estado vazio — não mostra os dois', () => {
    const fixture = montar();
    fixture.componentInstance.erro.set(new ApiError(500, 'Falha ao carregar.'));
    fixture.componentInstance.vazio.set(true);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Nenhum parceiro cadastrado');
  });

  it('troca o texto do vazio quando há filtro aplicado', () => {
    const fixture = montar();
    fixture.componentInstance.vazio.set(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Nenhum parceiro cadastrado');

    fixture.componentInstance.filtrado.set(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Nenhum parceiro para esses filtros');
  });

  it('desenha o conteúdo projetado quando não há carga, erro nem vazio', () => {
    const fixture = montar();
    expect(fixture.nativeElement.querySelector('.conteudo')).not.toBeNull();
  });
});

describe('ConfirmService (UI-081)', () => {
  function servico(): ConfirmService {
    TestBed.configureTestingModule({});
    return TestBed.inject(ConfirmService);
  }

  it('resolve true somente quando o usuário confirma', async () => {
    const confirmacao = servico();
    const pedido = confirmacao.confirmar({ titulo: 'Inativar parceiro?' });

    expect(confirmacao.pedido()?.titulo).toBe('Inativar parceiro?');
    confirmacao.responder(true);

    await expect(pedido).resolves.toBe(true);
    expect(confirmacao.pedido()).toBeNull();
  });

  it('fechar sem escolher conta como recusa', async () => {
    const confirmacao = servico();
    const pedido = confirmacao.confirmar({ titulo: 'Excluir alerta?' });
    confirmacao.responder(false);
    await expect(pedido).resolves.toBe(false);
  });

  it('um pedido novo recusa o anterior em vez de deixá-lo pendurado', async () => {
    const confirmacao = servico();
    const primeiro = confirmacao.confirmar({ titulo: 'Inativar produto?' });
    const segundo = confirmacao.confirmar({ titulo: 'Inativar categoria?' });

    await expect(primeiro).resolves.toBe(false);
    expect(confirmacao.pedido()?.titulo).toBe('Inativar categoria?');

    confirmacao.responder(true);
    await expect(segundo).resolves.toBe(true);
  });
});
