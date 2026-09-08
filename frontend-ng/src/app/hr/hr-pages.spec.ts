import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';

import { SGE_INTERCEPTORS } from '../core/api/interceptors';
import { AuthService } from '../core/auth/auth.service';
import { activeCompanyStore } from '../core/company/active-company-store';
import { CompanyService } from '../core/company/company.service';
import { makeMembership, makeUser } from '../core/test/factories';
import { EmployeeCompensationPage } from './employee-compensation-page';
import { EmployeeFormPage } from './employee-form-page';
import { EmployeeHistoryPage } from './employee-history-page';
import { EmployeesPage } from './employees-page';
import { PayrollPage } from './payroll-page';
import { ReimbursementsPage } from './reimbursements-page';
import { consultaFuncionario, consultaReembolso } from './rotulos';

const BASE = '/api/v1';

function paginado<T>(data: T[], total = data.length) {
  return { data, total, page: 1, pageSize: 20, totalPages: 1 };
}

const FUNCIONARIO = {
  id: 'func-1',
  companyId: 'empresa-1',
  branchId: null,
  userId: null,
  registration: '0042',
  name: 'Gil Ferreira',
  taxId: '39053344705',
  rg: null,
  pis: null,
  birthDate: null,
  corporateEmail: null,
  phone: null,
  positionId: 'cargo-1',
  position: { id: 'cargo-1', code: 'CG-014', name: 'Analista financeiro' },
  departmentId: 'dep-1',
  department: { id: 'dep-1', code: 'DP-02', name: 'Financeiro' },
  costCenterId: null,
  managerId: null,
  manager: null,
  hireDate: '2021-08-14',
  terminationDate: null,
  terminationReason: null,
  contractType: 'CLT',
  status: 'ATIVO',
  baseSalary: '6662.00',
};

/** Sessão com as permissões pedidas, como o `AuthService` exporia. */
function prepararSessao(permissoes: string[]): void {
  const membership = makeMembership({ permissions: permissoes });
  const usuario = makeUser({ memberships: [membership] });

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
          superAdmin: () => false,
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
          prontidao: () => Promise.resolve(),
          recarregarPlataforma: () => {},
        },
      },
    ],
  });
}

describe('filtros do RH', () => {
  it('não envia situação nem departamento em branco', () => {
    expect(consultaFuncionario({ q: 'gil', status: '', departmentId: '' })).toEqual({
      q: 'gil',
      status: undefined,
      departmentId: undefined,
    });
  });

  it('traduz a situação escolhida para o filtro da API', () => {
    expect(consultaFuncionario({ q: '', status: 'DESLIGADO' })).toMatchObject({
      status: 'DESLIGADO',
    });
    expect(consultaReembolso({ q: '', status: 'APROVADO' })).toMatchObject({
      status: 'APROVADO',
    });
  });
});

describe('EmployeesPage (UI-013)', () => {
  let fixture: ComponentFixture<EmployeesPage>;
  let mock: HttpTestingController;

  const texto = () => (fixture.nativeElement as HTMLElement).textContent ?? '';

  beforeEach(async () => {
    prepararSessao(['employees:READ', 'departments:READ']);
    mock = TestBed.inject(HttpTestingController);

    fixture = TestBed.createComponent(EmployeesPage);
    fixture.detectChanges();

    mock
      .match((r) => r.url === `${BASE}/employees`)
      .forEach((requisicao) =>
        requisicao.flush(
          requisicao.request.params.get('pageSize') === '1'
            ? paginado([], 7)
            : paginado([FUNCIONARIO]),
        ),
      );
    mock.expectOne((r) => r.url === `${BASE}/departments`).flush(paginado([]));

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('mostra matrícula, cargo, admissão e situação legíveis', () => {
    expect(texto()).toContain('0042');
    expect(texto()).toContain('Gil Ferreira');
    expect(texto()).toContain('Analista financeiro');
    expect(texto()).toContain('14/08/2021');
    expect(texto()).toContain('Ativo');
  });

  it('conta as situações numa consulta fixa, não uma por linha', () => {
    // Quatro contagens (`pageSize=1`) e a listagem: sem N+1 por funcionário.
    expect(texto()).toContain('Ativos');
    expect(texto()).toContain('Desligados');
    mock.verify();
  });
});

describe('EmployeeFormPage (UI-013)', () => {
  it('não manda admissão nem salário base no PATCH — os dois são eventos', async () => {
    prepararSessao(['employees:READ', 'employees:UPDATE']);
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: { snapshot: { paramMap: { get: () => 'func-1' } } },
    });
    const mock = TestBed.inject(HttpTestingController);

    const fixture = TestBed.createComponent(EmployeeFormPage);
    fixture.detectChanges();

    mock.expectOne(`${BASE}/employees/func-1`).flush(FUNCIONARIO);
    // Lista de gestores do select; sem permissão de cargo/departamento/filial,
    // as demais referências nem são pedidas.
    mock.match((r) => r.url === `${BASE}/employees`).forEach((r) => r.flush(paginado([])));
    fixture.detectChanges();
    await fixture.whenStable();

    const pagina = fixture.componentInstance as unknown as { salvar: () => void };
    pagina.salvar();

    const patch = mock.expectOne(`${BASE}/employees/func-1`);
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body.hireDate).toBeUndefined();
    expect(patch.request.body.baseSalary).toBeUndefined();
    expect(patch.request.body.registration).toBe('0042');
    patch.flush(FUNCIONARIO);
  });

  it('cria o funcionário com admissão e salário base como string decimal', async () => {
    prepararSessao(['employees:CREATE']);
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: { snapshot: { paramMap: { get: () => 'novo' } } },
    });
    const mock = TestBed.inject(HttpTestingController);

    const fixture = TestBed.createComponent(EmployeeFormPage);
    fixture.detectChanges();
    mock.match((r) => r.url === `${BASE}/employees`).forEach((r) => r.flush(paginado([])));
    await fixture.whenStable();

    const pagina = fixture.componentInstance as unknown as {
      mudar: (campo: string, valor: string) => void;
      salvar: () => void;
    };
    pagina.mudar('registration', '0201');
    pagina.mudar('name', 'Marina Reis');
    pagina.mudar('taxId', '390.533.447-05');
    pagina.mudar('hireDate', '2026-03-03');
    pagina.mudar('baseSalary', '3200.50');
    pagina.salvar();

    const criacao = mock.expectOne(`${BASE}/employees`);
    expect(criacao.request.method).toBe('POST');
    expect(criacao.request.body.taxId).toBe('39053344705');
    expect(criacao.request.body.hireDate).toBe('2026-03-03');
    // Dinheiro nunca vira `number` no caminho da tela até a API (RN-012).
    expect(criacao.request.body.baseSalary).toBe('3200.50');
    // Sem flush: a resposta levaria o formulário a navegar para a rota do novo
    // registro, que o roteador vazio deste teste não conhece.
  });
});

describe('EmployeeHistoryPage (UI-015)', () => {
  it('registra o evento no funcionário da rota e recarrega o histórico', async () => {
    prepararSessao(['employees:READ', 'employee-events:READ', 'employee-events:CREATE']);
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: { snapshot: { paramMap: { get: () => 'func-1' } } },
    });
    const mock = TestBed.inject(HttpTestingController);

    const fixture = TestBed.createComponent(EmployeeHistoryPage);
    fixture.detectChanges();

    mock.expectOne((r) => r.url === `${BASE}/employees/func-1/events`).flush(paginado([]));
    mock.expectOne(`${BASE}/employees/func-1`).flush(FUNCIONARIO);
    fixture.detectChanges();
    await fixture.whenStable();

    const pagina = fixture.componentInstance as unknown as {
      mudarEvento: (campo: string, valor: string) => void;
      salvarEvento: () => void;
    };
    pagina.mudarEvento('type', 'PROMOCAO');
    pagina.mudarEvento('startDate', '2026-03-01');
    pagina.mudarEvento('salary', '7200.00');
    pagina.salvarEvento();

    const criacao = mock.expectOne(`${BASE}/employees/func-1/events`);
    expect(criacao.request.method).toBe('POST');
    expect(criacao.request.body.type).toBe('PROMOCAO');
    expect(criacao.request.body.salary).toBe('7200.00');
    criacao.flush({ id: 'ev-1' });

    // Depois de registrar, histórico e cadastro voltam do servidor: a situação
    // e o salário são projetados lá, não calculados na tela.
    mock.expectOne((r) => r.url === `${BASE}/employees/func-1/events`).flush(paginado([]));
    mock.expectOne(`${BASE}/employees/func-1`).flush(FUNCIONARIO);
  });

  it('desliga pela rota própria, com motivo — não por PATCH de situação', async () => {
    prepararSessao(['employees:READ', 'employee-events:READ', 'employees:DELETE']);
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: { snapshot: { paramMap: { get: () => 'func-1' } } },
    });
    const mock = TestBed.inject(HttpTestingController);

    const fixture = TestBed.createComponent(EmployeeHistoryPage);
    fixture.detectChanges();
    mock.expectOne((r) => r.url === `${BASE}/employees/func-1/events`).flush(paginado([]));
    mock.expectOne(`${BASE}/employees/func-1`).flush(FUNCIONARIO);
    await fixture.whenStable();

    const pagina = fixture.componentInstance as unknown as {
      mudarDesligamento: (campo: string, valor: string) => void;
      desligar: () => void;
    };
    pagina.mudarDesligamento('terminationDate', '2026-09-30');
    pagina.mudarDesligamento('reason', 'Pedido de demissão');
    pagina.desligar();

    const desligamento = mock.expectOne(`${BASE}/employees/func-1/terminate`);
    expect(desligamento.request.method).toBe('POST');
    expect(desligamento.request.body.reason).toBe('Pedido de demissão');
    desligamento.flush({ ...FUNCIONARIO, status: 'DESLIGADO' });

    mock.expectOne((r) => r.url === `${BASE}/employees/func-1/events`).flush(paginado([]));
  });
});

describe('EmployeeCompensationPage (UI-016)', () => {
  it('barra valor fixo e percentual juntos antes de chamar a API', async () => {
    prepararSessao(['compensation:READ', 'compensation:CREATE', 'employees:READ']);
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: { snapshot: { paramMap: { get: () => 'func-1' } } },
    });
    const mock = TestBed.inject(HttpTestingController);

    const fixture = TestBed.createComponent(EmployeeCompensationPage);
    fixture.detectChanges();
    mock.expectOne(`${BASE}/employees/func-1/payroll-items`).flush([]);
    mock.expectOne(`${BASE}/employees/func-1`).flush(FUNCIONARIO);
    await fixture.whenStable();

    const pagina = fixture.componentInstance as unknown as {
      mudar: (campo: string, valor: string) => void;
      salvar: () => void;
      conflitoValor: () => boolean;
    };
    pagina.mudar('payrollItemId', 'verba-1');
    pagina.mudar('effectiveFrom', '2026-01-01');
    pagina.mudar('amount', '748.00');
    pagina.mudar('percentage', '6');

    expect(pagina.conflitoValor()).toBe(true);
    pagina.salvar();
    // Nada foi enviado: o banco recusaria os dois critérios juntos.
    mock.verify();
  });
});

describe('PayrollPage (UI-016)', () => {
  it('achata a consolidação da competência em lançamentos por funcionário', async () => {
    prepararSessao(['payroll:READ']);
    const mock = TestBed.inject(HttpTestingController);

    const fixture = TestBed.createComponent(PayrollPage);
    fixture.detectChanges();

    const consulta = mock.expectOne((r) => r.url === `${BASE}/payroll/summary`);
    expect(consulta.request.params.get('competence')).toMatch(/^\d{4}-\d{2}$/);
    consulta.flush({
      competence: '2026-09',
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
      employees: [
        {
          employeeId: 'func-1',
          registration: '0042',
          name: 'Gil Ferreira',
          taxId: '39053344705',
          positionId: null,
          departmentId: null,
          costCenterId: null,
          status: 'ATIVO',
          hireDate: '2021-08-14',
          terminationDate: null,
          lines: [
            {
              payrollItemId: 'verba-1',
              code: 'SAL',
              name: 'Salário base',
              type: 'SALARIO',
              amount: '6662.00',
              categoryId: null,
              ledgerAccountId: null,
              affectsInss: true,
              affectsIrrf: true,
              affectsFgts: true,
            },
          ],
          totals: {
            earnings: '6662.00',
            deductions: '0.00',
            employerCharges: '0.00',
            net: '6662.00',
            inssBase: '6662.00',
            irrfBase: '6662.00',
            fgtsBase: '6662.00',
          },
        },
      ],
      totals: {
        employees: 1,
        earnings: '6662.00',
        deductions: '0.00',
        employerCharges: '0.00',
        net: '6662.00',
      },
    });

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('Gil Ferreira');
    expect(texto).toContain('Salário base');
    // Formatação pt-BR a partir do decimal canônico, sem passar por `number`.
    expect(texto).toContain('R$ 6.662,00');
    expect(texto).toContain('INSS / IRRF / FGTS');
  });
});

describe('ReimbursementsPage (UI-017)', () => {
  const REEMBOLSO = {
    id: 'reemb-1',
    branchId: null,
    employeeId: 'func-1',
    employee: { id: 'func-1', registration: '0042', name: 'Gil Ferreira', userId: null },
    number: 'RB-0090',
    description: 'Hospedagem — treinamento fiscal',
    requestDate: '2026-09-02',
    totalAmount: '1280.00',
    approvedAmount: null,
    status: 'EM_ANALISE',
    costCenterId: null,
    payableId: null,
    approvedBy: null,
    approvedAt: null,
    note: null,
    items: [
      {
        id: 'item-1',
        description: 'Hotel',
        expenseDate: '2026-09-01',
        amount: '1280.00',
        categoryId: null,
        costCenterId: null,
        documentId: null,
        document: null,
        approved: null,
        note: null,
      },
    ],
  };

  function montar(permissoes: string[]) {
    prepararSessao(permissoes);
    const mock = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(ReimbursementsPage);
    fixture.detectChanges();

    mock
      .match((r) => r.url === `${BASE}/reimbursements`)
      .forEach((requisicao) =>
        requisicao.flush(
          requisicao.request.params.get('pageSize') === '1'
            ? paginado([], 3)
            : paginado([REEMBOLSO]),
        ),
      );
    mock.match((r) => r.url === `${BASE}/employees`).forEach((r) => r.flush(paginado([])));
    fixture.detectChanges();
    return { fixture, mock };
  }

  it('mostra número, valor e a contagem de comprovantes da solicitação', async () => {
    const { fixture } = montar(['reimbursements:READ']);
    await fixture.whenStable();
    fixture.detectChanges();

    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('RB-0090');
    expect(texto).toContain('R$ 1.280,00');
    expect(texto).toContain('0/1');
  });

  it('aprova pela rota de transição, com o valor como string decimal', async () => {
    const { fixture, mock } = montar(['reimbursements:READ', 'reimbursements:APPROVE']);
    await fixture.whenStable();

    const pagina = fixture.componentInstance as unknown as {
      abrirDetalhe: (r: unknown) => void;
      valorAprovado: { set: (v: string) => void };
      executar: (acao: string) => void;
    };
    pagina.abrirDetalhe(REEMBOLSO);
    mock.expectOne(`${BASE}/reimbursements/reemb-1`).flush(REEMBOLSO);

    pagina.valorAprovado.set('1200.00');
    pagina.executar('approve');

    const aprovacao = mock.expectOne(`${BASE}/reimbursements/reemb-1/approve`);
    expect(aprovacao.request.method).toBe('POST');
    expect(aprovacao.request.body.approvedAmount).toBe('1200.00');
    // Nenhum PATCH de `status`: a máquina de estados é do backend.
    aprovacao.flush({ ...REEMBOLSO, status: 'APROVADO', approvedAmount: '1200.00' });
  });

  it('anexa o comprovante como multipart na rota do item (RF-019)', async () => {
    const { fixture, mock } = montar(['reimbursements:READ', 'reimbursements:UPDATE']);
    await fixture.whenStable();

    const pagina = fixture.componentInstance as unknown as {
      abrirDetalhe: (r: unknown) => void;
      anexar: (r: unknown, item: unknown, evento: Event) => void;
    };
    pagina.abrirDetalhe(REEMBOLSO);
    mock.expectOne(`${BASE}/reimbursements/reemb-1`).flush(REEMBOLSO);

    const arquivo = new File(['x'], 'nota.pdf', { type: 'application/pdf' });
    const entrada = document.createElement('input');
    entrada.type = 'file';
    Object.defineProperty(entrada, 'files', { value: [arquivo] });
    pagina.anexar(REEMBOLSO, REEMBOLSO.items[0], { target: entrada } as unknown as Event);

    const upload = mock.expectOne(`${BASE}/reimbursements/reemb-1/items/item-1/receipt`);
    expect(upload.request.method).toBe('POST');
    expect(upload.request.body).toBeInstanceOf(FormData);
    // O boundary é do navegador: definir Content-Type na mão quebraria o upload.
    expect(upload.request.headers.get('Content-Type')).toBeNull();
    upload.flush({ id: 'doc-1', fileName: 'nota.pdf', mimeType: 'application/pdf', sizeBytes: 1 });
  });
});
