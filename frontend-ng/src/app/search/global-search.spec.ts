import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';

import { SGE_INTERCEPTORS } from '../core/api/interceptors';
import type { UserProfile } from '../core/api/types';
import { AuthService } from '../core/auth/auth.service';
import { CompanyService } from '../core/company/company.service';
import { activeCompanyStore } from '../core/company/active-company-store';
import { GlobalSearchService, type ResultadoBusca } from '../core/search/global-search.service';
import { makeMembership, makeUser } from '../core/test/factories';
import { GlobalSearch } from './global-search';

const BASE = '/api/v1';
const EMPRESA = 'aaaaaaaa-1111-4111-8111-111111111111';

function usuarioCom(permissions: string[]): UserProfile {
  return makeUser({ memberships: [makeMembership({ companyId: EMPRESA, permissions })] });
}

describe('GlobalSearchService (UI-077)', () => {
  let mock: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    activeCompanyStore.set(null);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors(SGE_INTERCEPTORS)),
        provideHttpClientTesting(),
      ],
    });
    mock = TestBed.inject(HttpTestingController);
  });

  async function autenticar(usuario: UserProfile): Promise<GlobalSearchService> {
    const auth = TestBed.inject(AuthService);
    TestBed.inject(CompanyService);
    const busca = TestBed.inject(GlobalSearchService);
    const entrando = auth.login('jamile@empresa.com.br', 'senha');
    mock
      .expectOne(`${BASE}/auth/login`)
      .flush({ accessToken: 'tok', refreshToken: 'ref', tokenType: 'Bearer', user: usuario });
    await entrando;
    TestBed.tick();
    return busca;
  }

  it('consulta apenas as entidades que o perfil libera', async () => {
    const busca = await autenticar(usuarioCom(['partners:READ']));

    const resultados: ResultadoBusca[] = [];
    busca.buscar('acme').subscribe((r) => resultados.push(...r));

    mock.expectNone(`${BASE}/products?q=acme&pageSize=5`);
    mock.expectOne(`${BASE}/partners?q=acme&pageSize=5`).flush({
      data: [
        {
          id: 'p1',
          legalName: 'Acme Indústria LTDA',
          tradeName: 'Acme',
          cnpj: '12345678000190',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 5,
    });

    expect(resultados).toHaveLength(1);
    expect(resultados[0].grupo).toBe('Parceiros');
    expect(resultados[0].titulo).toBe('Acme Indústria LTDA');
    expect(resultados[0].subtitulo).toBe('12.345.678/0001-90');
    expect(resultados[0].rota).toEqual(['/cadastros', 'parceiros', 'p1']);
    mock.verify();
  });

  it('uma entidade que falha não derruba o resultado das outras', async () => {
    const busca = await autenticar(usuarioCom(['partners:READ', 'products:READ']));

    const resultados: ResultadoBusca[] = [];
    busca.buscar('acme').subscribe((r) => resultados.push(...r));

    mock
      .expectOne(`${BASE}/partners?q=acme&pageSize=5`)
      .flush({ data: [{ id: 'p1', legalName: 'Acme', tradeName: null, cnpj: null }], total: 1 });
    mock
      .expectOne(`${BASE}/products?q=acme&pageSize=5`)
      .flush({ message: 'Falhou' }, { status: 500, statusText: 'Server Error' });

    expect(resultados.map((r) => r.grupo)).toEqual(['Parceiros']);
  });

  it('não vai à rede com menos de dois caracteres', async () => {
    const busca = await autenticar(usuarioCom(['partners:READ']));

    let chamou = false;
    busca.buscar('a').subscribe((r) => (chamou = r.length === 0));

    expect(chamou).toBe(true);
    mock.verify();
  });
});

describe('GlobalSearch (UI-077)', () => {
  const resultado: ResultadoBusca = {
    id: 'p1',
    grupo: 'Parceiros',
    titulo: 'Acme Indústria LTDA',
    subtitulo: 'Cliente',
    rota: ['/cadastros', 'parceiros', 'p1'],
  };
  const segundo: ResultadoBusca = {
    ...resultado,
    id: 'p2',
    titulo: 'Acme Serviços',
    rota: ['/cadastros', 'parceiros', 'p2'],
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: GlobalSearchService, useValue: { buscar: () => of([resultado, segundo]) } },
      ],
    });
  });

  it('abre com Ctrl+K e foca o campo', async () => {
    const fixture = TestBed.createComponent(GlobalSearch);
    fixture.detectChanges();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    fixture.detectChanges();

    const campo = document.querySelector('input[role="combobox"]') as HTMLInputElement | null;
    expect(campo).not.toBeNull();
    expect(campo?.placeholder).toContain('Buscar parceiro');
  });

  it('as setas percorrem os resultados e o Enter abre o registro destacado', async () => {
    const fixture = TestBed.createComponent(GlobalSearch);
    const router = TestBed.inject(Router);
    const navegar = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture.detectChanges();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    fixture.detectChanges();

    const campo = document.querySelector('input[role="combobox"]') as HTMLInputElement;
    campo.value = 'acme';
    campo.dispatchEvent(new Event('input'));
    await new Promise((resolve) => setTimeout(resolve, 300));
    fixture.detectChanges();

    expect(document.body.textContent).toContain('Acme Serviços');

    campo.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    fixture.detectChanges();
    campo.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();

    expect(navegar).toHaveBeenCalledWith(['/cadastros', 'parceiros', 'p2']);
  });
});
