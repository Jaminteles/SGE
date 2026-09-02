import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, NetworkError } from '../core/api/errors';
import { ErrorAlert } from './error-alert';
import { FilterBar, type ValoresFiltro } from './filter-bar';
import { TextField } from './text-field';

describe('TextField (UI-006)', () => {
  @Component({
    imports: [FormsModule, TextField],
    template: `
      <sge-text-field
        rotulo="Razão social"
        dica="Como consta no CNPJ"
        [erro]="erro()"
        [(ngModel)]="valor"
        name="razao"
      />
    `,
  })
  class Hospedeiro {
    valor = '';
    readonly erro = signal<string | null>(null);
  }

  let fixture: ComponentFixture<Hospedeiro>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Hospedeiro] }).compileComponents();
    fixture = TestBed.createComponent(Hospedeiro);
    fixture.detectChanges();
  });

  it('liga rótulo, dica e erro ao campo', () => {
    fixture.componentInstance.erro.set('Informe a razão social.');
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    const rotulo = fixture.nativeElement.querySelector('label') as HTMLLabelElement;

    expect(rotulo.getAttribute('for')).toBe(input.id);
    expect(input.getAttribute('aria-invalid')).toBe('true');

    const ids = (input.getAttribute('aria-describedby') ?? '').split(' ');
    const textos = ids.map(
      (id) => fixture.nativeElement.querySelector(`#${id}`)?.textContent?.trim(),
    );
    expect(textos).toContain('Como consta no CNPJ');
    expect(textos).toContain('Informe a razão social.');
  });

  it('não descreve por nada quando não há dica nem erro visíveis', () => {
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    // Só a dica está presente; o erro não deve aparecer na lista.
    expect(input.getAttribute('aria-describedby')).not.toContain('-erro');
    expect(input.getAttribute('aria-invalid')).toBeNull();
  });

  it('emite o que o usuário digita', () => {
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    input.value = 'Empresa Fantasma Teste LTDA';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(fixture.componentInstance.valor).toBe('Empresa Fantasma Teste LTDA');
  });
});

describe('ErrorAlert (UI-005)', () => {
  @Component({
    imports: [ErrorAlert],
    template: `<sge-error-alert [erro]="erro()" />`,
  })
  class Hospedeiro {
    readonly erro = signal<unknown>(null);
  }

  let fixture: ComponentFixture<Hospedeiro>;
  const texto = () => fixture.nativeElement.textContent as string;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Hospedeiro] }).compileComponents();
    fixture = TestBed.createComponent(Hospedeiro);
    fixture.detectChanges();
  });

  it('não desenha nada sem erro', () => {
    expect(fixture.nativeElement.querySelector('.alerta')).toBeNull();
  });

  it('anuncia erro com papel de alerta', () => {
    fixture.componentInstance.erro.set(new ApiError(403, 'Você não tem permissão.'));
    fixture.detectChanges();

    const alerta = fixture.nativeElement.querySelector('.alerta');
    expect(alerta?.getAttribute('role')).toBe('alert');
    expect(texto()).toContain('Acesso negado');
    expect(texto()).toContain('Você não tem permissão.');
  });

  it('lista os erros de validação devolvidos pela API', () => {
    fixture.componentInstance.erro.set(
      new ApiError(400, 'legalName não pode ser vazio', {
        code: 'Bad Request',
        details: ['legalName não pode ser vazio', 'taxId deve ter 14 dígitos'],
      }),
    );
    fixture.detectChanges();

    const itens = [...fixture.nativeElement.querySelectorAll('.alerta__detalhes li')].map(
      (li) => (li as HTMLElement).textContent?.trim(),
    );
    expect(itens).toEqual(['legalName não pode ser vazio', 'taxId deve ter 14 dígitos']);
  });

  it('não repete a lista quando há um único erro de validação', () => {
    fixture.componentInstance.erro.set(
      new ApiError(400, 'legalName não pode ser vazio', {
        details: ['legalName não pode ser vazio'],
      }),
    );
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.alerta__detalhes')).toBeNull();
    expect(texto()).toContain('legalName não pode ser vazio');
  });

  it('traduz falha de rede', () => {
    fixture.componentInstance.erro.set(new NetworkError());
    fixture.detectChanges();
    expect(texto()).toContain('Sem conexão com o servidor');
  });
});

describe('FilterBar (UI-006)', () => {
  @Component({
    imports: [FilterBar],
    template: `
      <sge-filter-bar
        [valores]="valores()"
        [filtros]="[
          {
            name: 'situacao',
            label: 'Situação',
            options: [
              { value: 'ATIVO', label: 'Ativo' },
              { value: 'INATIVO', label: 'Inativo' },
            ],
          },
        ]"
        (mudou)="receber($event)"
      />
    `,
  })
  class Hospedeiro {
    readonly valores = signal<ValoresFiltro>({ q: '', situacao: '' });
    emissoes: ValoresFiltro[] = [];
    receber(v: ValoresFiltro): void {
      this.emissoes.push(v);
      this.valores.set(v);
    }
  }

  let fixture: ComponentFixture<Hospedeiro>;
  let host: Hospedeiro;

  beforeEach(async () => {
    vi.useFakeTimers();
    await TestBed.configureTestingModule({ imports: [Hospedeiro] }).compileComponents();
    fixture = TestBed.createComponent(Hospedeiro);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function buscar(termo: string): void {
    const input = fixture.nativeElement.querySelector('input[type=search]') as HTMLInputElement;
    input.value = termo;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  it('espera o usuário parar de digitar antes de emitir', () => {
    buscar('fer');
    buscar('ferra');
    buscar('ferragens');

    // Nada saiu ainda: seriam três consultas ao servidor por uma busca só.
    expect(host.emissoes).toEqual([]);

    vi.advanceTimersByTime(300);
    fixture.detectChanges();

    expect(host.emissoes.length).toBe(1);
    expect(host.emissoes[0].q).toBe('ferragens');
  });

  it('não emite quando o termo volta a ser o mesmo já aplicado', () => {
    buscar('abc');
    vi.advanceTimersByTime(300);
    fixture.detectChanges();
    expect(host.emissoes.length).toBe(1);

    buscar('abc');
    vi.advanceTimersByTime(300);
    fixture.detectChanges();
    expect(host.emissoes.length).toBe(1);
  });
});
