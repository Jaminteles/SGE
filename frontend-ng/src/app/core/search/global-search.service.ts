import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { CatalogApiService } from '../api/catalog-api.service';
import { EmployeesApiService } from '../api/employees-api.service';
import { FinanceApiService } from '../api/finance-api.service';
import { FiscalDocumentsApiService } from '../api/fiscal-documents-api.service';
import { PartnersApiService } from '../api/partners-api.service';
import { PurchasingApiService } from '../api/purchasing-api.service';
import type { PaginatedResult } from '../api/types';
import { PermissionsService } from '../authz/permissions.service';
import { formatCurrency } from '../lib/decimal';
import { formatCnpj, formatDate } from '../lib/format';

export interface ResultadoBusca {
  id: string;
  /** Nome do grupo na lista — "Parceiros", "Títulos", … */
  grupo: string;
  titulo: string;
  subtitulo: string;
  /** Rota do registro, no formato aceito por `router.navigate`. */
  rota: unknown[];
}

/** Quantos registros cada entidade devolve para a busca. */
const POR_ENTIDADE = 5;

/**
 * Busca global por entidade (UI-077).
 *
 * Não existe endpoint de busca única no backend, e inventar um só para a caixa
 * do topo custaria uma varredura por várias tabelas a cada tecla. Em vez disso
 * a busca reaproveita o `q` das listagens que já existem: uma requisição por
 * entidade, cinco linhas cada, em paralelo.
 *
 * Só consulta as entidades que o perfil pode ler — não para proteger nada (a
 * autorização é do backend, a cada requisição, somada à RLS), mas para não
 * gastar requisição que voltaria 403. Uma entidade que falhar entra vazia: um
 * módulo fora do ar não pode derrubar a busca inteira.
 */
@Injectable({ providedIn: 'root' })
export class GlobalSearchService {
  private readonly permissoes = inject(PermissionsService);
  private readonly parceiros = inject(PartnersApiService);
  private readonly catalogo = inject(CatalogApiService);
  private readonly financeiro = inject(FinanceApiService);
  private readonly compras = inject(PurchasingApiService);
  private readonly funcionarios = inject(EmployeesApiService);
  private readonly fiscal = inject(FiscalDocumentsApiService);

  buscar(termo: string): Observable<ResultadoBusca[]> {
    const texto = termo.trim();
    if (texto.length < 2) return of([]);

    const fontes: Observable<ResultadoBusca[]>[] = [];

    if (this.permissoes.pode('partners:READ')) {
      fontes.push(
        this.consultar(this.parceiros.list({ q: texto, pageSize: POR_ENTIDADE }), (parceiro) => ({
          id: parceiro.id,
          grupo: 'Parceiros',
          titulo: parceiro.legalName,
          subtitulo: parceiro.cnpj ? formatCnpj(parceiro.cnpj) : (parceiro.tradeName ?? ''),
          rota: ['/cadastros', 'parceiros', parceiro.id],
        })),
      );
    }

    if (this.permissoes.pode('products:READ')) {
      fontes.push(
        this.consultar(this.catalogo.list({ q: texto, pageSize: POR_ENTIDADE }), (produto) => ({
          id: produto.id,
          grupo: 'Produtos',
          titulo: produto.description,
          subtitulo: produto.code,
          rota: ['/cadastros', 'catalogo', produto.id],
        })),
      );
    }

    if (this.permissoes.pode('financial-entries:READ')) {
      fontes.push(
        this.consultar(
          this.financeiro.listEntries({ q: texto, pageSize: POR_ENTIDADE }),
          (titulo) => ({
            id: titulo.id,
            grupo: 'Títulos',
            titulo: `${titulo.number} · ${titulo.description}`,
            // O vencimento mora na parcela: um título pode ter várias, e a
            // primeira em aberto é a que interessa a quem está procurando.
            subtitulo: `${titulo.type === 'PAGAR' ? 'A pagar' : 'A receber'} · ${formatCurrency(
              titulo.netAmount,
            )} · emitido em ${formatDate(titulo.issueDate)}`,
            rota: ['/financeiro', 'titulos', titulo.id],
          }),
        ),
      );
    }

    if (this.permissoes.pode('purchase-orders:READ')) {
      fontes.push(
        this.consultar(this.compras.listOrders({ q: texto, pageSize: POR_ENTIDADE }), (pedido) => ({
          id: pedido.id,
          grupo: 'Pedidos de compra',
          titulo: `Pedido ${pedido.number}`,
          subtitulo: `${pedido.partner?.legalName ?? ''} · ${formatDate(pedido.orderDate)}`,
          rota: ['/compras', 'pedidos', pedido.id],
        })),
      );
    }

    if (this.permissoes.pode('employees:READ')) {
      fontes.push(
        this.consultar(
          this.funcionarios.list({ q: texto, pageSize: POR_ENTIDADE }),
          (funcionario) => ({
            id: funcionario.id,
            grupo: 'Funcionários',
            titulo: funcionario.name,
            subtitulo: `Matrícula ${funcionario.registration}${
              funcionario.position ? ` · ${funcionario.position.name}` : ''
            }`,
            rota: ['/rh', 'funcionarios', funcionario.id],
          }),
        ),
      );
    }

    if (this.permissoes.pode('fiscal-documents:READ')) {
      fontes.push(
        this.consultar(this.fiscal.list({ q: texto, pageSize: POR_ENTIDADE }), (documento) => ({
          id: documento.id,
          grupo: 'Documentos fiscais',
          titulo: `${documento.model} ${documento.number}${
            documento.series ? `/${documento.series}` : ''
          }`,
          subtitulo: `${documento.issuerName ?? documento.issuerPartner?.legalName ?? ''} · ${formatDate(
            documento.issuedAt,
          )}`,
          rota: ['/fiscal', 'documentos', documento.id],
        })),
      );
    }

    if (fontes.length === 0) return of([]);
    return forkJoin(fontes).pipe(map((grupos) => grupos.flat()));
  }

  private consultar<T>(
    consulta: Observable<PaginatedResult<T>>,
    paraResultado: (item: T) => ResultadoBusca,
  ): Observable<ResultadoBusca[]> {
    return consulta.pipe(
      map((pagina) => pagina.data.map(paraResultado)),
      catchError(() => of([])),
    );
  }
}
