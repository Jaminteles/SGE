import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SessionService } from '../auth/session.service';
import { activeCompanyStore } from '../company/active-company-store';
import { ApprovalsApiService } from './approvals-api.service';
import { AuditApiService } from './audit-api.service';
import { BranchesApiService } from './branches-api.service';
import { CompaniesApiService } from './companies-api.service';
import { ConfigurationsApiService } from './configurations-api.service';
import { SGE_INTERCEPTORS } from './interceptors';
import { RolesApiService } from './roles-api.service';
import { UsersApiService } from './users-api.service';

const BASE = '/api/v1';
const EMPRESA = '11111111-1111-4111-8111-111111111111';

describe('services de administração (UI-007 a UI-012)', () => {
  let mock: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    activeCompanyStore.set(EMPRESA);

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors(SGE_INTERCEPTORS)),
        provideHttpClientTesting(),
      ],
    });

    mock = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionService).definirTokens({
      accessToken: 'token-abc',
      refreshToken: 'refresh-abc',
    });
  });

  afterEach(() => {
    mock.verify();
    activeCompanyStore.set(null);
  });

  it('escopa filiais pela empresa ativa (RF-005)', () => {
    TestBed.inject(BranchesApiService).list({ page: 2, pageSize: 20, q: 'salvador' }).subscribe();

    const req = mock.expectOne(`${BASE}/branches?page=2&pageSize=20&q=salvador`);
    expect(req.request.headers.get('x-company-id')).toBe(EMPRESA);
    req.flush({ data: [], total: 0, page: 2, pageSize: 20, totalPages: 0 });
  });

  it('escopa vínculos, perfis e alçadas pela empresa ativa', () => {
    TestBed.inject(UsersApiService).listMemberships().subscribe();
    TestBed.inject(RolesApiService).list().subscribe();
    TestBed.inject(ApprovalsApiService).list().subscribe();

    for (const rota of ['memberships', 'roles', 'approval-thresholds']) {
      const req = mock.expectOne(`${BASE}/${rota}`);
      expect(req.request.headers.get('x-company-id')).toBe(EMPRESA);
      req.flush({ data: [], total: 0, page: 1, pageSize: 20, totalPages: 0 });
    }
  });

  it('não manda empresa nas rotas de plataforma (empresas e usuários)', () => {
    TestBed.inject(CompaniesApiService).list().subscribe();
    TestBed.inject(UsersApiService).listUsers().subscribe();

    for (const rota of ['companies', 'users']) {
      const req = mock.expectOne(`${BASE}/${rota}`);
      expect(req.request.headers.has('x-company-id')).toBe(false);
      expect(req.request.headers.get('Authorization')).toBe('Bearer token-abc');
      req.flush({ data: [], total: 0, page: 1, pageSize: 20, totalPages: 0 });
    }
  });

  it('omite filtro vazio para não pedir "situação = string vazia"', () => {
    TestBed.inject(BranchesApiService).list({ q: '', isActive: undefined, page: 1 }).subscribe();

    mock
      .expectOne(`${BASE}/branches?page=1`)
      .flush({ data: [], total: 0, page: 1, pageSize: 20, totalPages: 0 });
  });

  it('ativa e inativa empresa pelas rotas de ciclo de vida (RF-001)', () => {
    const api = TestBed.inject(CompaniesApiService);

    api.setActive('empresa-1', false).subscribe();
    const inativar = mock.expectOne(`${BASE}/companies/empresa-1/inactivate`);
    expect(inativar.request.method).toBe('POST');
    inativar.flush({});

    api.setActive('empresa-1', true).subscribe();
    mock.expectOne(`${BASE}/companies/empresa-1/activate`).flush({});
  });

  it('envia o parâmetro de escopo dos parâmetros da empresa (RF-006)', () => {
    TestBed.inject(ConfigurationsApiService).listSettings('FISCAL').subscribe();

    mock.expectOne(`${BASE}/settings?scope=FISCAL`).flush([]);
  });

  it('consulta a trilha com período e evento (RF-117)', () => {
    TestBed.inject(AuditApiService)
      .list({ from: '2026-09-01T00:00:00.000Z', event: 'PAGAMENTO', page: 1 })
      .subscribe();

    const req = mock.expectOne(
      (r) => r.url === `${BASE}/audit` && r.params.get('event') === 'PAGAMENTO',
    );
    expect(req.request.params.get('from')).toBe('2026-09-01T00:00:00.000Z');
    req.flush({ data: [], total: 0, page: 1, pageSize: 20, totalPages: 0 });
  });
});
