import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { SGE_INTERCEPTORS } from '../api/interceptors';
import type { UserProfile } from '../api/types';
import { AuthService } from '../auth/auth.service';
import { activeCompanyStore } from '../company/active-company-store';
import { CompanyService } from '../company/company.service';
import { makeMembership, makeUser } from '../test/factories';
import { CanDirective } from './can.directive';

const BASE = '/api/v1';
const EMPRESA_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const EMPRESA_B = 'bbbbbbbb-2222-4222-8222-222222222222';

@Component({
  imports: [CanDirective],
  template: `
    <button *sgeCan="'partners:CREATE'" data-teste="codigo">Novo parceiro</button>
    <span *sgeCan="['company:READ', 'partners:READ']" data-teste="lista">Todas</span>
    <span *sgeCan="{ any: ['audit:READ', 'partners:READ'] }" data-teste="qualquer">Alguma</span>
    <span *sgeCan="'audit:READ'; else semAcesso" data-teste="comElse">Auditoria</span>
    <ng-template #semAcesso>
      <em data-teste="alternativo">Sem permissão no perfil</em>
    </ng-template>
  `,
})
class Hospedeiro {}

describe('CanDirective', () => {
  let mock: HttpTestingController;
  let fixture: ComponentFixture<Hospedeiro>;

  const visivel = (teste: string): boolean =>
    fixture.nativeElement.querySelector(`[data-teste="${teste}"]`) !== null;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    activeCompanyStore.set(null);

    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors(SGE_INTERCEPTORS)), provideHttpClientTesting()],
    });
    mock = TestBed.inject(HttpTestingController);
  });

  async function montar(usuario: UserProfile | null): Promise<void> {
    if (usuario) {
      const auth = TestBed.inject(AuthService);
      const entrando = auth.login('jamile@empresa.com.br', 'senha');
      mock
        .expectOne(`${BASE}/auth/login`)
        .flush({ accessToken: 'tok', refreshToken: 'ref', tokenType: 'Bearer', user: usuario });
      await entrando;
    }
    fixture = TestBed.createComponent(Hospedeiro);
    fixture.detectChanges();
  }

  it('esconde tudo que exige permissão quando não há usuário', async () => {
    await montar(null);
    expect(visivel('codigo')).toBe(false);
    expect(visivel('lista')).toBe(false);
    expect(visivel('qualquer')).toBe(false);
  });

  it('mostra o conteúdo quando o perfil tem a permissão do código', async () => {
    await montar(
      makeUser({
        memberships: [makeMembership({ companyId: EMPRESA_A, permissions: ['partners:CREATE'] })],
      }),
    );
    expect(visivel('codigo')).toBe(true);
  });

  it('trata lista como exigência de todas as permissões', async () => {
    await montar(
      makeUser({
        memberships: [makeMembership({ companyId: EMPRESA_A, permissions: ['company:READ'] })],
      }),
    );
    // Falta `partners:READ`, então a lista inteira não passa.
    expect(visivel('lista')).toBe(false);
    // Mas o `any` passa, porque uma das duas basta.
    expect(visivel('qualquer')).toBe(false);
  });

  it('aceita a forma composta com any', async () => {
    await montar(
      makeUser({
        memberships: [makeMembership({ companyId: EMPRESA_A, permissions: ['partners:READ'] })],
      }),
    );
    expect(visivel('qualquer')).toBe(true);
    expect(visivel('lista')).toBe(false);
  });

  it('renderiza o conteúdo alternativo quando falta a permissão', async () => {
    await montar(
      makeUser({
        memberships: [makeMembership({ companyId: EMPRESA_A, permissions: ['partners:READ'] })],
      }),
    );
    expect(visivel('comElse')).toBe(false);
    expect(visivel('alternativo')).toBe(true);
  });

  it('mostra o principal e esconde o alternativo quando a permissão existe', async () => {
    await montar(
      makeUser({
        memberships: [makeMembership({ companyId: EMPRESA_A, permissions: ['audit:READ'] })],
      }),
    );
    expect(visivel('comElse')).toBe(true);
    expect(visivel('alternativo')).toBe(false);
  });

  it('reage à troca de empresa ativa sem remontar o componente', async () => {
    await montar(
      makeUser({
        memberships: [
          makeMembership({
            companyId: EMPRESA_A,
            isDefault: true,
            permissions: ['partners:CREATE'],
          }),
          makeMembership({ companyId: EMPRESA_B, isDefault: false, permissions: ['audit:READ'] }),
        ],
      }),
    );

    expect(visivel('codigo')).toBe(true);
    expect(visivel('comElse')).toBe(false);

    TestBed.inject(CompanyService).selecionar(EMPRESA_B);
    fixture.detectChanges();

    expect(visivel('codigo')).toBe(false);
    expect(visivel('comElse')).toBe(true);
  });

  it('libera tudo para o super admin', async () => {
    await montar(
      makeUser({
        isSuperAdmin: true,
        memberships: [makeMembership({ companyId: EMPRESA_A, permissions: [] })],
      }),
    );
    expect(visivel('codigo')).toBe(true);
    expect(visivel('lista')).toBe(true);
    expect(visivel('qualquer')).toBe(true);
    expect(visivel('comElse')).toBe(true);
  });
});
