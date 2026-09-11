import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { Provider } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';

import { SGE_INTERCEPTORS } from '../core/api/interceptors';
import type { FiscalDocument, FiscalDocumentItem } from '../core/api/types';
import { AuthService } from '../core/auth/auth.service';
import { activeCompanyStore } from '../core/company/active-company-store';
import { CompanyService } from '../core/company/company.service';
import { makeMembership, makeUser } from '../core/test/factories';
import { FiscalAttachmentsPanel, metadadosLegiveis } from './fiscal-attachments-panel';
import { FiscalCollectionPage } from './fiscal-collection-page';
import { FiscalDocumentDetailPage } from './fiscal-document-detail-page';
import { FiscalDocumentsPage } from './fiscal-documents-page';
import { compararDocumentos } from './fiscal-duplicate-panel';
import { FiscalImportPage, type ItemFila, problemaArquivo } from './fiscal-import-page';
import {
  EFEITOS_VAZIO,
  FiscalLinksPanel,
  formVinculosDe,
  montarEfeitos,
  montarVinculos,
  problemasEfeitos,
} from './fiscal-links-panel';
import {
  consultaNota,
  descartavel,
  efeitosPendentes,
  formatarChave,
  reprocessavel,
} from './rotulos';

const BASE = '/api/v1';
const CHAVE = '35260901637895000132550010000010011000010019';

function item(sobrescrever: Partial<FiscalDocumentItem> = {}): FiscalDocumentItem {
  return {
    id: 'item-1',
    sequence: 1,
    productId: 'prod-1',
    product: { id: 'prod-1', code: 'CIM-50', description: 'Cimento CP-II 50kg', tracksStock: true },
    supplierCode: '7891',
    description: 'CIMENTO CP II 50KG',
    ncm: '25232910',
    cest: null,
    cfop: '5102',
    unit: 'SC',
    quantity: '10.000000',
    unitPrice: '15.000000',
    discountAmount: '0.00',
    freightAmount: '0.00',
    lineAmount: '150.00',
    icmsCst: '00',
    icmsBase: '150.00',
    icmsRate: '12.000000',
    icmsAmount: '18.00',
    icmsStAmount: '0.00',
    ipiAmount: '0.00',
    pisAmount: '0.98',
    cofinsAmount: '4.50',
    ...sobrescrever,
  };
}

function nota(sobrescrever: Partial<FiscalDocument> = {}): FiscalDocument {
  return {
    id: 'doc-1',
    model: 'NFE',
    accessKey: CHAVE,
    number: '1001',
    series: '1',
    issuedAt: '2026-09-01T10:00:00.000Z',
    issuerName: 'Votorantim Cimentos SA',
    issuerPartner: {
      id: 'par-1',
      legalName: 'Votorantim Cimentos SA',
      tradeName: 'Votorantim',
      cnpj: '01637895000132',
      cpf: null,
    },
    totalAmount: '150.00',
    status: 'PROCESSADO',
    purchaseOrderId: null,
    receipts: [],
    financialEntries: [],
    branchId: null,
    branch: null,
    operationType: '1',
    operationNature: 'Venda de mercadoria',
    movedAt: null,
    issuerPartnerId: 'par-1',
    issuerTaxId: '01637895000132',
    recipientPartnerId: null,
    recipientPartner: null,
    recipientTaxId: '11222333000181',
    recipientName: 'Construtora Exemplo Ltda',
    productsAmount: '150.00',
    discountAmount: '0.00',
    freightAmount: '0.00',
    insuranceAmount: '0.00',
    otherExpenseAmount: '0.00',
    icmsAmount: '18.00',
    icmsStAmount: '0.00',
    ipiAmount: '0.00',
    pisAmount: '0.98',
    cofinsAmount: '4.50',
    issAmount: '0.00',
    origin: 'UPLOAD_MANUAL',
    originReference: null,
    collectedAt: null,
    xmlHash: 'ab'.repeat(32),
    attempts: 1,
    processingError: null,
    processedAt: null,
    duplicateOfId: null,
    duplicateOf: null,
    purchaseOrder: null,
    generatedStock: false,
    generatedPayable: false,
    metadata: { versao: '4.00', protocolo: { numero: '1' } },
    createdById: null,
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: '2026-09-01T12:00:00.000Z',
    items: [item()],
    ...sobrescrever,
  };
}

function paginado<T>(data: T[], total = data.length) {
  return { data, total, page: 1, pageSize: 20, totalPages: 1 };
}

function prepararSessao(
  permissoes: string[],
  extras: Provider[] = [],
): { mock: HttpTestingController; companyId: string } {
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
      ...extras,
    ],
  });

  return { mock: TestBed.inject(HttpTestingController), companyId: membership.companyId };
}

function rota(id: string): Provider {
  return {
    provide: ActivatedRoute,
    useValue: {
      snapshot: { paramMap: convertToParamMap({ id }), queryParamMap: convertToParamMap({}) },
    },
  };
}

function entradaCom(arquivos: File[]): Event {
  const entrada = document.createElement('input');
  entrada.type = 'file';
  Object.defineProperty(entrada, 'files', { value: arquivos });
  return { target: entrada } as unknown as Event;
}

// ---------------------------------------------------------------------------

describe('regras de tela do documento fiscal', () => {
  it('manda o fim do período como o dia seguinte (to exclusivo) e a pendência como booleano', () => {
    expect(
      consultaNota({ q: '', status: 'ERRO', pendingOnly: 'true', to: '2026-09-30' }),
    ).toMatchObject({ status: 'ERRO', pendingOnly: true, to: '2026-10-01' });
  });

  it('espelha as situações do backend: reprocesso, descarte e efeitos', () => {
    expect(reprocessavel(nota({ status: 'ERRO' }))).toBe(true);
    expect(reprocessavel(nota({ status: 'PROCESSADO' }))).toBe(false);
    expect(descartavel(nota({ status: 'DUPLICADO' }))).toBe(true);
    // Documento que já gerou efeito não se descarta: estorno é no módulo de origem.
    expect(descartavel(nota({ generatedPayable: true }))).toBe(false);
    expect(descartavel(nota({ status: 'CANCELADO' }))).toBe(false);
    // Nota com recebimento: a entrada é do recebimento (RN-004).
    const recebida = nota({
      receipts: [{ id: 'rec-1', number: 'RC-1', receivedAt: '2026-09-02', generatedStock: true }],
    });
    expect(efeitosPendentes(recebida)).toEqual({ estoque: false, titulo: false });
    expect(efeitosPendentes(nota({ generatedStock: true }))).toEqual({ estoque: false, titulo: true });
  });

  it('formata a chave em blocos de 4 e recusa localmente o que não é XML', () => {
    expect(formatarChave(CHAVE).split(' ')).toHaveLength(11);
    expect(problemaArquivo(new File(['x'], 'nota.txt'))).toBe('Não é um arquivo .xml.');
    expect(problemaArquivo(new File([], 'vazia.xml'))).toBe('Arquivo vazio.');
    expect(problemaArquivo(new File(['<nfeProc/>'], 'NOTA.XML'))).toBeNull();
  });
});

describe('FiscalImportPage — fila de importação (UI-036)', () => {
  type Pagina = {
    adicionarArquivos: (e: Event) => void;
    iniciar: () => void;
    fila: () => ItemFila[];
    resumo: () => { aguardando: number; duplicados: number; recusados: number; importados: number };
  };

  it('envia um arquivo por vez, como multipart, e mostra a situação de cada um', () => {
    const { mock, companyId } = prepararSessao(['fiscal-documents:CREATE']);
    const fixture = TestBed.createComponent(FiscalImportPage);
    fixture.detectChanges();
    const pagina = fixture.componentInstance as unknown as Pagina;

    pagina.adicionarArquivos(
      entradaCom([
        new File(['<nfeProc/>'], 'a.xml', { type: 'text/xml' }),
        new File(['x'], 'b.pdf', { type: 'application/pdf' }),
        new File(['<nfeProc/>'], 'c.xml', { type: 'text/xml' }),
      ]),
    );
    // O PDF é recusado na tela, sem requisição.
    expect(pagina.fila().map((i) => i.estado)).toEqual(['AGUARDANDO', 'RECUSADO', 'AGUARDANDO']);

    pagina.iniciar();
    // Em série: só o primeiro está no ar.
    const primeiro = mock.expectOne(`${BASE}/fiscal-documents/import`);
    expect(primeiro.request.method).toBe('POST');
    expect(primeiro.request.body).toBeInstanceOf(FormData);
    expect((primeiro.request.body as FormData).get('file')).toBeInstanceOf(File);
    // Nada que descreva a nota vai no formulário: o backend lê do XML.
    expect((primeiro.request.body as FormData).get('number')).toBeNull();
    expect(primeiro.request.headers.get('Content-Type')).toBeNull();
    expect(primeiro.request.headers.get('x-company-id')).toBe(companyId);

    primeiro.flush({
      outcome: 'DUPLICADO',
      document: nota({ id: 'doc-dup', status: 'DUPLICADO' }),
      reason: 'Mesma chave de acesso do documento 1000, com conteúdo diferente (RF-046).',
    });

    const segundo = mock.expectOne(`${BASE}/fiscal-documents/import`);
    segundo.flush(
      { statusCode: 400, message: 'XML inválido: raiz ausente.' },
      { status: 400, statusText: 'Bad Request' },
    );
    mock.verify();

    const [a, , c] = pagina.fila();
    expect(a).toMatchObject({ estado: 'CONCLUIDO', resultado: 'DUPLICADO' });
    expect(a.documento?.id).toBe('doc-dup');
    expect(c.estado).toBe('RECUSADO');
    expect(c.motivo).toContain('XML inválido');
    expect(pagina.resumo()).toMatchObject({ aguardando: 0, duplicados: 1, recusados: 2 });

    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Documento duplicado na fila');
  });
});

describe('FiscalDocumentsPage — situação por documento (UI-036/UI-038)', () => {
  it('mostra a duplicata apontando o original e o erro de processamento', () => {
    const { mock } = prepararSessao(['fiscal-documents:READ']);
    const fixture = TestBed.createComponent(FiscalDocumentsPage);
    fixture.detectChanges();

    mock.expectOne((r) => r.url === `${BASE}/fiscal-documents`).flush(
      paginado([
        nota({
          id: 'doc-dup',
          status: 'DUPLICADO',
          duplicateOf: { id: 'doc-orig', number: '1000', accessKey: CHAVE, status: 'PROCESSADO' },
        }),
        nota({ id: 'doc-erro', status: 'ERRO', processingError: 'Total não fecha.' }),
      ]),
    );
    fixture.detectChanges();

    const texto = fixture.nativeElement.textContent as string;
    expect(texto).toContain('Duplicado');
    expect(texto).toContain('de 1000');
    expect(texto).toContain('Total não fecha.');
    // Sem `fiscal-documents:UPDATE`, não há reprocessamento.
    expect(texto).not.toContain('Reprocessar');
  });
});

describe('FiscalDocumentDetailPage — detalhe e duplicidade (UI-037/UI-038)', () => {
  it('compara com o original e descarta a duplicata com o motivo sugerido', async () => {
    const { mock } = prepararSessao(
      ['fiscal-documents:READ', 'fiscal-documents:DELETE'],
      [rota('doc-dup')],
    );
    const fixture = TestBed.createComponent(FiscalDocumentDetailPage);
    const duplicata = nota({
      id: 'doc-dup',
      status: 'DUPLICADO',
      totalAmount: '160.00',
      duplicateOfId: 'doc-orig',
      duplicateOf: { id: 'doc-orig', number: '1000', accessKey: CHAVE, status: 'PROCESSADO' },
    });
    mock.expectOne(`${BASE}/fiscal-documents/doc-dup`).flush(duplicata);
    fixture.detectChanges();
    await fixture.whenStable();

    mock.expectOne(`${BASE}/fiscal-documents/doc-orig`).flush(nota({ id: 'doc-orig', number: '1000' }));
    mock.expectOne(`${BASE}/fiscal-documents/doc-dup/attachments`).flush([]);
    fixture.detectChanges();

    const texto = fixture.nativeElement.textContent as string;
    // Detalhe (UI-037): chave, emitente, destinatário, itens e tributos.
    expect(texto).toContain('3526 0901');
    expect(texto).toContain('01.637.895/0001-32');
    expect(texto).toContain('Construtora Exemplo Ltda');
    expect(texto).toContain('CIMENTO CP II 50KG');
    expect(texto).toContain('CST 00');
    // Duplicidade (UI-038).
    expect(texto).toContain('Documento duplicado');
    expect(texto).toContain('Comparação com o original');

    const botao = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(
      (b) => b.textContent?.includes('Descartar duplicata'),
    );
    botao!.click();

    const pagina = fixture.componentInstance as unknown as {
      motivo: () => string;
      descarteAberto: () => boolean;
      descartar: () => void;
    };
    expect(pagina.descarteAberto()).toBe(true);
    expect(pagina.motivo()).toBe('Duplicata do documento 1000; mantido o original.');

    pagina.descartar();
    const descarte = mock.expectOne(`${BASE}/fiscal-documents/doc-dup/cancel`);
    expect(descarte.request.method).toBe('POST');
    expect(descarte.request.body).toEqual({
      reason: 'Duplicata do documento 1000; mantido o original.',
    });
    descarte.flush({ ...duplicata, status: 'CANCELADO' });
    mock.verify();
  });

  it('compara campo a campo e marca o que difere', () => {
    const linhas = compararDocumentos(
      nota({ totalAmount: '160.00' }),
      nota({ id: 'doc-orig', totalAmount: '150.00' }),
    );
    expect(linhas.find((l) => l.campo === 'Valor total')?.difere).toBe(true);
    expect(linhas.find((l) => l.campo === 'Emitente')?.difere).toBe(false);
  });
});

describe('FiscalLinksPanel — vínculos e efeitos (UI-039)', () => {
  it('manda só o que mudou: null desfaz, ausente não mexe', () => {
    const registro = nota({ items: [item(), item({ id: 'item-2', sequence: 2, productId: null, product: null })] });
    const form = formVinculosDe(registro);
    expect(montarVinculos(registro, form)).toEqual({});

    form.issuerPartnerId = '';
    form.itens['item-2'] = 'prod-9';
    expect(montarVinculos(registro, form)).toEqual({
      issuerPartnerId: null,
      items: [{ itemId: 'item-2', productId: 'prod-9' }],
    });
  });

  it('diz o que impede o efeito antes do clique e monta o corpo explícito', () => {
    const semProduto = nota({ items: [item({ productId: null, product: null })] });
    expect(problemasEfeitos(semProduto, EFEITOS_VAZIO)).toContain(
      'Escolha ao menos um efeito: entrada de estoque ou título a pagar.',
    );
    expect(
      problemasEfeitos(semProduto, { ...EFEITOS_VAZIO, gerarEstoque: true, localId: 'loc-1' }),
    ).toContain('Vincule e salve o produto dos itens 1.');
    expect(
      problemasEfeitos(nota(), { ...EFEITOS_VAZIO, gerarTitulo: true, parcelas: '0' }),
    ).toContain('O número de parcelas vai de 1 a 120.');

    expect(
      montarEfeitos({
        ...EFEITOS_VAZIO,
        gerarTitulo: true,
        condicaoId: 'cond-1',
        primeiroVencimento: '2026-10-10',
        parcelas: '3',
      }),
    ).toEqual({
      generateStock: false,
      generatePayable: true,
      payable: { paymentTermId: 'cond-1', firstDueDate: '2026-10-10', installmentCount: 3 },
    });
  });

  it('salva vínculos com PATCH parcial e gera a entrada de estoque com o local', () => {
    const { mock, companyId } = prepararSessao([
      'fiscal-documents:READ',
      'fiscal-documents:UPDATE',
      'fiscal-postings:CREATE',
      'stock-locations:READ',
    ]);
    const fixture = TestBed.createComponent(FiscalLinksPanel);
    fixture.componentRef.setInput('nota', nota());
    fixture.detectChanges();

    mock
      .expectOne((r) => r.url === `${BASE}/stock-locations`)
      .flush(
        paginado([
          { id: 'loc-1', branchId: 'fil-1', branch: null, code: 'CD', name: 'Central', isDefault: true, isActive: true },
        ]),
      );

    const emitidos: FiscalDocument[] = [];
    fixture.componentInstance.atualizada.subscribe((registro) => emitidos.push(registro));

    const painel = fixture.componentInstance as unknown as {
      mudar: (campo: string, valor: string) => void;
      mudarEfeito: (campo: string, valor: unknown) => void;
      salvarVinculos: () => void;
      gerar: () => void;
      problemas: () => string[];
    };

    painel.mudar('purchaseOrderId', 'ped-1');
    painel.salvarVinculos();
    const vinculo = mock.expectOne(`${BASE}/fiscal-documents/doc-1/links`);
    expect(vinculo.request.method).toBe('PATCH');
    expect(vinculo.request.body).toEqual({ purchaseOrderId: 'ped-1' });
    expect(vinculo.request.headers.get('x-company-id')).toBe(companyId);
    vinculo.flush(nota({ purchaseOrderId: 'ped-1' }));
    expect(emitidos).toHaveLength(1);

    painel.mudarEfeito('gerarEstoque', true);
    expect(painel.problemas()).toContain('Escolha o local de estoque da entrada.');
    painel.mudarEfeito('localId', 'loc-1');
    expect(painel.problemas()).toEqual([]);

    painel.gerar();
    // Um clique, uma requisição — o segundo é ignorado enquanto a primeira está no ar.
    painel.gerar();
    const efeito = mock.expectOne(`${BASE}/fiscal-documents/doc-1/postings`);
    expect(efeito.request.body).toEqual({
      generateStock: true,
      generatePayable: false,
      locationId: 'loc-1',
    });
    efeito.flush(nota({ generatedStock: true }));
    expect(emitidos.at(-1)?.generatedStock).toBe(true);
    mock.verify();
  });
});

describe('FiscalAttachmentsPanel — anexos e metadados (UI-040)', () => {
  it('lista, anexa DANFE como multipart e recusa arquivo grande sem enviar', () => {
    const { mock } = prepararSessao(['fiscal-documents:READ', 'fiscal-documents:UPDATE']);
    const fixture = TestBed.createComponent(FiscalAttachmentsPanel);
    fixture.componentRef.setInput('nota', nota());
    fixture.detectChanges();

    mock.expectOne(`${BASE}/fiscal-documents/doc-1/attachments`).flush([]);

    const painel = fixture.componentInstance as unknown as {
      anexar: (e: Event) => void;
      baixarXml: () => void;
      problema: () => string | null;
    };

    const grande = new File(['%PDF'], 'grande.pdf', { type: 'application/pdf' });
    Object.defineProperty(grande, 'size', { value: 11 * 1024 * 1024 });
    painel.anexar(entradaCom([grande]));
    mock.verify();
    expect(painel.problema()).toContain('10 MB');

    painel.anexar(entradaCom([new File(['%PDF'], 'danfe.pdf', { type: 'application/pdf' })]));
    const envio = mock.expectOne(`${BASE}/fiscal-documents/doc-1/attachments`);
    expect(envio.request.method).toBe('POST');
    expect((envio.request.body as FormData).get('category')).toBe('DANFE');
    expect(envio.request.headers.get('Content-Type')).toBeNull();
    envio.flush({
      id: 'anx-1',
      fileName: 'danfe.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 4,
      sha256: null,
      category: 'DANFE',
      createdAt: '2026-09-02T10:00:00.000Z',
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('danfe.pdf');

    // O XML original sai como Blob, nunca como link direto para a API.
    const criar = vi.fn(() => 'blob:xml');
    const revogar = vi.fn();
    Object.assign(URL, { createObjectURL: criar, revokeObjectURL: revogar });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    painel.baixarXml();
    const xml = mock.expectOne(`${BASE}/fiscal-documents/doc-1/xml`);
    expect(xml.request.responseType).toBe('blob');
    xml.flush(new Blob(['<nfeProc/>']));
    expect(revogar).toHaveBeenCalledWith('blob:xml');
  });

  it('mostra só metadados simples do XML', () => {
    expect(metadadosLegiveis({ versao: '4.00', protocolo: { numero: '1' } })).toEqual([
      ['versao', '4.00'],
    ]);
  });
});

describe('FiscalCollectionPage — coleta automática e reprocessamento (UI-041)', () => {
  it('recorta a coleta, conta no servidor e reprocessa em série só o que está em erro', () => {
    const { mock } = prepararSessao(['fiscal-documents:READ', 'fiscal-documents:UPDATE']);
    const fixture = TestBed.createComponent(FiscalCollectionPage);
    fixture.detectChanges();

    const inicio = mock.match((r) => r.url === `${BASE}/fiscal-documents`);
    expect(inicio).toHaveLength(5);
    for (const req of inicio) {
      expect(req.request.params.get('origin')).toBe('COLETA_AUTOMATICA');
    }
    const [lista, ...contagens] = [
      inicio.find((r) => r.request.params.get('pageSize') !== '1')!,
      ...inicio.filter((r) => r.request.params.get('pageSize') === '1'),
    ];
    lista.flush(
      paginado([
        nota({ id: 'doc-a', number: '2001', status: 'ERRO', origin: 'COLETA_AUTOMATICA' }),
        nota({ id: 'doc-b', number: '2002', status: 'PROCESSADO', origin: 'COLETA_AUTOMATICA' }),
      ]),
    );
    for (const req of contagens) {
      req.flush(paginado([], req.request.params.get('status') === 'ERRO' ? 1 : 2));
    }
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Reprocessar com erro nesta página (1)');

    (fixture.componentInstance as unknown as { reprocessarPagina: () => void }).reprocessarPagina();
    const reprocesso = mock.expectOne(`${BASE}/fiscal-documents/doc-a/reprocess`);
    expect(reprocesso.request.method).toBe('POST');
    reprocesso.flush({ outcome: 'IMPORTADO', document: nota({ id: 'doc-a', status: 'PROCESSADO' }) });

    // Terminado o lote, a lista e os indicadores voltam do servidor.
    expect(mock.match((r) => r.url === `${BASE}/fiscal-documents`)).toHaveLength(5);
    expect(
      (fixture.componentInstance as unknown as { aviso: () => string | null }).aviso(),
    ).toContain('1 processado(s)');
  });
});
