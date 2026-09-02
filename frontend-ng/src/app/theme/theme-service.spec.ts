import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { ThemeService } from './theme-service';

/** O efeito do serviço só roda quando a mudança é liberada. */
function servico(): ThemeService {
  const service = TestBed.inject(ThemeService);
  TestBed.tick();
  return service;
}

describe('ThemeService', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
    TestBed.resetTestingModule();
  });

  it('nasce escuro quando não há escolha salva', () => {
    const service = servico();
    expect(service.tema()).toBe('dark');
    expect(document.documentElement.classList.contains('sge-dark')).toBe(true);
  });

  it('respeita a escolha salva pelo usuário', () => {
    localStorage.setItem('sge.tema', 'light');
    const service = servico();
    expect(service.tema()).toBe('light');
    expect(document.documentElement.classList.contains('sge-dark')).toBe(false);
  });

  it('alterna e persiste a escolha', () => {
    const service = servico();

    service.alternar();
    TestBed.tick();
    expect(service.tema()).toBe('light');
    expect(service.escuro()).toBe(false);
    expect(document.documentElement.classList.contains('sge-dark')).toBe(false);
    expect(localStorage.getItem('sge.tema')).toBe('light');

    service.alternar();
    TestBed.tick();
    expect(service.tema()).toBe('dark');
    expect(document.documentElement.classList.contains('sge-dark')).toBe(true);
    expect(localStorage.getItem('sge.tema')).toBe('dark');
  });

  it('ignora valor inválido no storage e volta ao padrão escuro', () => {
    localStorage.setItem('sge.tema', 'xpto');
    expect(servico().tema()).toBe('dark');
  });
});
