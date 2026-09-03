import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';

import { SGE_INTERCEPTORS } from '../core/api/interceptors';
import { AuthService } from '../core/auth/auth.service';
import { activeCompanyStore } from '../core/company/active-company-store';
import { CompanyService } from '../core/company/company.service';
import { makeMembership, makeUser } from '../core/test/factories';
import { AuditPage } from '../audit/audit-page';
import { CompaniesPage } from './companies-page';
import { RolesPage } from './roles-page';
import { consultaPadrao } from './filtros';

const BASE = '/api/v1';

function paginado<T>(data: T[], total = data.length) {
  return { data, total, page: 1, pageSize: 20, totalPages: 1 };
}

/** Sessão com as permissões pedidas, como o `AuthService` exporia. */
function prepararSessao(permissoes: string[], { superAdmin = false } = {}): void {
  const membership = makeMembership({ permissions: permissoes });
  const usuario = makeUser({ isSuperAdmin: superAdmin, memberships: [membership] });

  // Com os interceptors reais, a URL sai prefixada e as rotas escopadas levam
  // o cabeçalho da empresa — é o caminho que a tela percorre em produção.
  localStorage.clear();
  activeCompanyStore.set(membership.companyId);

  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(withInterceptors(SGE_INTERCEPTORS)),
      provideHttpClientTesting(),
      {
        provide: AuthService,
        useValue: {
          usuario: () => usuario,
          superAdmin: () => superAdmin,
          autenticado: () => true,
          prontidao: () => Promise.resolve(),
        },
      },
      {
        provide: CompanyService,
        useValue: {
          ativaId: () => membership.companyId,
          ativa: () => membership,
          permissoes: () => new Set(permissoes),
        },
      },
    ],
  });
}

describe('consultaPadrao (filtros das listagens)', () => {
  it('não envia isActive quando a situação está em branco', () => {
    expect(consultaPadrao({ q: 'teste', situacao: '' })).toEqual({
      q: 'teste',
      isActive: undefined,
    });
  });

  it('traduz a situação escolhida para booleano', () => {
    expect(consultaPadrao({ q: '', situacao: 'false' })).toMatchObject({ isActive: false });
    expect(consultaPadrao({ q: '', situacao: 'true' })).toMatchObject({ isActive: true });
  });

  it('trata filtro ausente como "todas" — e não como inativas', () => {
    expect(consultaPadrao({ q: '' })).toMatchObject({ isActive: undefined });
  });
});

describe('CompaniesPage (UI-007)', () => {
  let fixture: ComponentFixture<CompaniesPage>;
  let mock: HttpTestingController;

  const texto = () => (fixture.nativeElement as HTMLElement).textContent ?? '';

  beforeEach(async () => {
    prepararSessao(['company:READ'], { superAdmin: true });
    mock = TestBed.inject(HttpTestingController);

    fixture = TestBed.createComponent(CompaniesPage);
    fixture.detectChanges();

    mock
      .expectOne((r) => r.url === `${BASE}/companies`)
      .flush(
        paginado([
          {
            id: 'empresa-1',
            legalName: 'Empresa Fantasma Teste LTDA',
            tradeName: 'Empresa Fantasma',
            taxId: '12345678000190',
            taxRegime: 'SIMPLES_NACIONAL',
            isActive: true,
          },
        ]),
      );
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('mostra a empresa com CNPJ formatado e regime legível', () => {
    expect(texto()).toContain('Empresa Fantasma Teste LTDA');
    expect(texto()).toContain('12.345.678/0001-90');
    expect(texto()).toContain('Simples Nacional');
  });

  it('inativa pela rota de ciclo de vida e recarrega a listagem (RF-001)', async () => {
    const botao = [...fixture.nativeElement.querySelectorAll('button')].find((b) =>
      (b as HTMLElement).textContent?.includes('Inativar'),
    ) as HTMLButtonElement;
    botao.click();
    fixture.detectChanges();

    mock.expectOne(`${BASE}/companies/empresa-1/inactivate`).flush({});
    mock.expectOne((r) => r.url === `${BASE}/companies`).flush(paginado([]));
    mock.verify();
  });
});

describe('RolesPage (UI-010)', () => {
  let fixture: ComponentFixture<RolesPage>;
  let mock: HttpTestingController;

  beforeEach(async () => {
    prepararSessao(['roles:READ', 'roles:UPDATE']);
    mock = TestBed.inject(HttpTestingController);

    fixture = TestBed.createComponent(RolesPage);
    fixture.detectChanges();

    mock.expectOne(`${BASE}/permissions`).flush([
      {
        code: 'branches:READ',
        module: 'M01',
        resource: 'branches',
        action: 'READ',
        description: '',
      },
      {
        code: 'branches:CREATE',
        module: 'M01',
        resource: 'branches',
        action: 'CREATE',
        description: '',
      },
      { code: 'audit:READ', module: 'M16', resource: 'audit', action: 'READ', description: '' },
    ]);
    mock
      .expectOne((r) => r.url === `${BASE}/roles`)
      .flush(
        paginado([
          {
            id: 'perfil-1',
            companyId: 'empresa-1',
            name: 'Contabilidade',
            description: null,
            isSystem: false,
            isActive: true,
            permissions: ['branches:READ'],
          },
        ]),
      );
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('monta a matriz a partir do catálogo do backend, não de uma lista local', () => {
    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('branches');
    expect(texto).toContain('audit');
    expect(texto).toContain('2 de 2 recursos');
  });

  it('envia a lista completa de permissões ao salvar (RF-011)', () => {
    const pagina = fixture.componentInstance as unknown as {
      alternar: (codigo: string, marcado: boolean) => void;
      salvarPermissoes: () => void;
    };

    pagina.alternar('branches:CREATE', true);
    pagina.salvarPermissoes();

    const req = mock.expectOne(`${BASE}/roles/perfil-1`);
    expect(req.request.method).toBe('PATCH');
    expect((req.request.body as { permissions: string[] }).permissions).toEqual(
      expect.arrayContaining(['branches:READ', 'branches:CREATE']),
    );
    req.flush({
      id: 'perfil-1',
      companyId: 'empresa-1',
      name: 'Contabilidade',
      description: null,
      isSystem: false,
      isActive: true,
      permissions: ['branches:READ', 'branches:CREATE'],
    });
  });
});

describe('AuditPage (UI-012)', () => {
  let fixture: ComponentFixture<AuditPage>;
  let mock: HttpTestingController;

  beforeEach(async () => {
    prepararSessao(['audit:READ']);
    mock = TestBed.inject(HttpTestingController);

    fixture = TestBed.createComponent(AuditPage);
    fixture.detectChanges();

    mock
      .expectOne((r) => r.url === `${BASE}/audit`)
      .flush(
        paginado([
          {
            id: '900719925474099101',
            event: 'ALTERACAO',
            entity: 'empresa',
            entityId: 'empresa-1',
            userId: 'usuario-1',
            userName: 'Jamínteles Moura',
            previousValue: { legalName: 'Antes' },
            currentValue: { legalName: 'Depois' },
            changedFields: ['legalName'],
            origin: 'API',
            ip: '191.0.2.20',
            userAgent: null,
            correlationId: null,
            note: null,
            occurredAt: '2026-09-02T11:41:12.000Z',
          },
        ]),
      );
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('preserva o id bigint como string, sem passar por number', () => {
    const linhas = fixture.componentInstance as unknown as {
      lista: { linhas: () => { id: string }[] };
    };
    expect(linhas.lista.linhas()[0].id).toBe('900719925474099101');
  });

  it('manda o fim do período como o dia seguinte, porque `to` é exclusivo', () => {
    const pagina = fixture.componentInstance as unknown as {
      mudarPeriodo: (campo: 'de' | 'ate', valor: string) => void;
    };

    pagina.mudarPeriodo('ate', '2026-09-02');

    const req = mock.expectOne((r) => r.url === `${BASE}/audit` && r.params.has('to'));
    expect(req.request.params.get('to')).toBe('2026-09-03T00:00:00.000Z');
    req.flush(paginado([]));
  });

  it('não manda busca textual: a trilha só aceita os filtros do DTO', () => {
    const pagina = fixture.componentInstance as unknown as {
      mudarEntidade: (valor: string) => void;
    };

    pagina.mudarEntidade('titulo');

    const req = mock.expectOne((r) => r.url === `${BASE}/audit` && r.params.has('entity'));
    expect(req.request.params.has('q')).toBe(false);
    req.flush(paginado([]));
  });
});
