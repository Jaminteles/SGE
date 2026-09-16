import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { BranchesApiService } from './branches-api.service';
import { CatalogApiService } from './catalog-api.service';
import { SGE_INTERCEPTORS } from './interceptors';
import { activeCompanyStore } from '../company/active-company-store';

const BASE = '/api/v1';
const EMPRESA_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const EMPRESA_B = 'bbbbbbbb-2222-4222-8222-222222222222';

function pagina() {
  return { data: [], total: 0, page: 1, pageSize: 20, totalPages: 0 };
}

describe('Cache de consultas (RNF-008 — UI-085)', () => {
  let mock: HttpTestingController;
  let filiais: BranchesApiService;

  beforeEach(() => {
    activeCompanyStore.set(EMPRESA_A);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors(SGE_INTERCEPTORS)),
        provideHttpClientTesting(),
      ],
    });
    mock = TestBed.inject(HttpTestingController);
    filiais = TestBed.inject(BranchesApiService);
  });

  it('serve a segunda consulta idêntica sem ir à rede', () => {
    filiais.list().subscribe();
    mock.expectOne(`${BASE}/branches`).flush(pagina());

    let respondeu = false;
    filiais.list().subscribe(() => (respondeu = true));

    expect(respondeu).toBe(true);
    mock.expectNone(`${BASE}/branches`);
  });

  it('não vaza resposta de uma empresa para outra', () => {
    filiais.list().subscribe();
    mock.expectOne(`${BASE}/branches`).flush(pagina());

    // Troca de empresa: a RLS do banco separaria os dados, e o cache não pode
    // desfazer isso devolvendo a lista da empresa anterior.
    activeCompanyStore.set(EMPRESA_B);
    filiais.list().subscribe();
    mock.expectOne(`${BASE}/branches`).flush(pagina());

    mock.verify();
  });

  it('descarta o recurso alterado por uma escrita', () => {
    const catalogo = TestBed.inject(CatalogApiService);

    catalogo.listCategories().subscribe();
    mock.expectOne(`${BASE}/product-categories`).flush(pagina());

    catalogo.createCategory({ name: 'Insumos' } as never).subscribe();
    mock.expectOne(`${BASE}/product-categories`).flush({});

    // Quem acabou de cadastrar precisa ver a categoria no próximo select.
    catalogo.listCategories().subscribe();
    mock.expectOne(`${BASE}/product-categories`).flush(pagina());

    // A escrita numa categoria não pode derrubar o cache das filiais.
    filiais.list().subscribe();
    mock.expectOne(`${BASE}/branches`).flush(pagina());
    filiais.list().subscribe();
    mock.expectNone(`${BASE}/branches`);
  });

  it('funde requisições idênticas que saem ao mesmo tempo', () => {
    let primeira = 0;
    let segunda = 0;
    filiais.list().subscribe(() => primeira++);
    filiais.list().subscribe(() => segunda++);

    // Uma requisição só, e as duas assinaturas recebem a mesma resposta.
    mock.expectOne(`${BASE}/branches`).flush(pagina());
    expect([primeira, segunda]).toEqual([1, 1]);
  });

  it('não cacheia a listagem comum, que não pediu cache', () => {
    const catalogo = TestBed.inject(CatalogApiService);
    catalogo.list().subscribe();
    mock.expectOne((r) => r.url === `${BASE}/products`).flush(pagina());

    catalogo.list().subscribe();
    mock.expectOne((r) => r.url === `${BASE}/products`).flush(pagina());
    mock.verify();
  });
});
