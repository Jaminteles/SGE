import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';

import { type ColunaExportavel } from '../core/lib/csv';
import { PartnersApiService } from '../core/api/partners-api.service';
import type { Partner } from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatCnpj } from '../core/lib/format';
import { ListState } from '../core/lib/list-state';
import { FILTRO_SITUACAO } from '../admin/filtros';
import { DataTable, type Coluna } from '../ui/data-table';
import { PrintExport } from '../ui/print-export';
import { ErrorAlert } from '../ui/error-alert';
import { FilterBar } from '../ui/filter-bar';
import { Alert } from '../ui/alert';
import { ConfirmService } from '../ui/confirm.service';
import { FILTRO_PAPEL, ROTULO_PESSOA, consultaParceiro, rotuloPapel } from './rotulos';

/** CPF apenas para exibição: "39053344705" -> "390.533.447-05". */
function formatCpf(valor: string | null): string {
  if (!valor) return '';
  const digitos = valor.replace(/\D/g, '');
  if (digitos.length !== 11) return valor;
  return digitos.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
}

/**
 * Clientes e fornecedores (RF-022 a RF-024 — UI-018).
 *
 * Uma listagem só para os dois papéis: `parceiro` é tabela única com
 * `eh_cliente`/`eh_fornecedor`, e o filtro de papel é `role` na API — não duas
 * telas nem dois cadastros.
 *
 * A coluna Cidade/UF do Figma não é desenhada aqui: o endereço é uma tabela à
 * parte e a listagem não o traz. Buscá-lo por linha seria o N+1 que a paginação
 * existe para evitar; a cidade aparece no formulário, na aba de endereços.
 */
@Component({
  selector: 'sge-partners-page',
  imports: [
    RouterLink,
    ButtonModule,
    TagModule,
    Alert,
    DataTable,
    ErrorAlert,
    FilterBar,
    PrintExport,
  ],
  template: `
    <p class="crumb">Cadastros / Parceiros</p>

    <div class="pagehead">
      <div>
        <h1>Clientes e fornecedores</h1>
        <p>Cadastro PF/PJ com papéis de cliente e fornecedor (RF-022 a RF-024).</p>
      </div>
      <div class="pagehead__actions">
        @if (podeCriar()) {
          <p-button label="Novo parceiro" icon="pi pi-plus" routerLink="novo" />
        }
      </div>
    </div>

    <sge-filter-bar
      chave="cadastros.parceiros"
      placeholderBusca="Buscar por nome, CPF ou CNPJ"
      [valores]="lista.filtros()"
      [filtros]="[FILTRO_PAPEL, FILTRO_SITUACAO]"
      (mudou)="lista.aplicarFiltros($event)"
    />

    @if (lista.erro(); as falha) {
      <div class="espaco"><sge-error-alert [erro]="falha" /></div>
    }

    @if (aviso(); as texto) {
      <div class="espaco"><sge-alert tom="sucesso" [titulo]="texto" /></div>
    }

    <section class="card table-card espaco">
      <sge-data-table
        chave="cadastros.parceiros"
        [colunas]="colunas"
        [linhas]="lista.linhas()"
        [total]="lista.total()"
        [pagina]="lista.pagina()"
        [tamanhoPagina]="lista.tamanhoPagina()"
        [carregando]="lista.carregando()"
        [mensagemVazia]="
          lista.temFiltro()
            ? 'Nenhum parceiro encontrado com esses filtros.'
            : 'Nenhum parceiro cadastrado.'
        "
        (paginaMudou)="lista.irParaPagina($event.page, $event.pageSize)"
      >
        <sge-print-export
          ferramentas
          nome="parceiros"
          [colunas]="colunasExportadas"
          [consulta]="exportarLista"
        />

        <ng-template #linha let-parceiro>
          <tr>
            <td>
              {{ parceiro.legalName }}
              @if (parceiro.tradeName) {
                <span class="secundario">{{ parceiro.tradeName }}</span>
              }
            </td>
            <td>{{ documento(parceiro) }}</td>
            <td>{{ pessoa(parceiro) }}</td>
            <td>{{ papel(parceiro) }}</td>
            <td>
              <p-tag
                [value]="parceiro.isActive ? 'Ativo' : 'Inativo'"
                [severity]="parceiro.isActive ? 'success' : 'secondary'"
                [rounded]="true"
              />
            </td>
            <td class="acoes">
              <p-button
                label="Abrir"
                severity="secondary"
                [text]="true"
                size="small"
                [routerLink]="[parceiro.id]"
              />
              @if (podeInativar() && parceiro.isActive) {
                <p-button
                  label="Inativar"
                  severity="secondary"
                  [text]="true"
                  size="small"
                  (onClick)="inativar(parceiro)"
                />
              }
            </td>
          </tr>
        </ng-template>
      </sge-data-table>
    </section>
  `,
})
export class PartnersPage {
  private readonly api = inject(PartnersApiService);
  private readonly confirmacao = inject(ConfirmService);
  private readonly permissoes = inject(PermissionsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly FILTRO_PAPEL = FILTRO_PAPEL;
  protected readonly FILTRO_SITUACAO = FILTRO_SITUACAO;

  /**
   * Colunas do CSV (RF-113 — UI-080). Não são as da tela: a listagem mostra
   * valores já formatados e junta campos na mesma célula; o arquivo leva o
   * dado como veio da API, para ser somado e filtrado na planilha.
   */
  protected readonly colunasExportadas: ColunaExportavel[] = [
    { campo: 'legalName', cabecalho: 'Razão social' },
    { campo: 'tradeName', cabecalho: 'Nome fantasia' },
    { campo: 'cnpj', cabecalho: 'CNPJ' },
    { campo: 'cpf', cabecalho: 'CPF' },
    { campo: 'personType', cabecalho: 'Tipo de pessoa' },
    { campo: 'isCustomer', cabecalho: 'Cliente' },
    { campo: 'isSupplier', cabecalho: 'Fornecedor' },
    { campo: 'isActive', cabecalho: 'Ativo' },
  ];

  protected readonly exportarLista = () => this.lista.exportar();

  protected readonly colunas: Coluna[] = [
    { campo: 'legalName', cabecalho: 'Nome / razão social' },
    { campo: 'document', cabecalho: 'CPF / CNPJ', largura: '13rem' },
    { campo: 'personType', cabecalho: 'Tipo', largura: '10rem' },
    { campo: 'role', cabecalho: 'Papel', largura: '12rem' },
    { campo: 'isActive', cabecalho: 'Situação', largura: '8rem' },
    { campo: 'acoes', cabecalho: '', largura: '11rem' },
  ];

  protected readonly lista = new ListState<Partner>(
    (consulta) => this.api.list(consulta),
    consultaParceiro,
  );

  protected readonly aviso = signal<string | null>(null);

  protected readonly podeCriar = () => this.permissoes.pode('partners:CREATE');
  protected readonly podeInativar = () => this.permissoes.pode('partners:DELETE');

  constructor() {
    this.lista.carregar();
  }

  protected documento(parceiro: Partner): string {
    if (parceiro.cnpj) return formatCnpj(parceiro.cnpj);
    if (parceiro.cpf) return formatCpf(parceiro.cpf);
    return parceiro.foreignDocument ?? '—';
  }

  protected pessoa(parceiro: Partner): string {
    return ROTULO_PESSOA[parceiro.personType] ?? parceiro.personType;
  }

  protected papel(parceiro: Partner): string {
    return rotuloPapel(parceiro);
  }

  protected async inativar(parceiro: Partner): Promise<void> {
    const confirmado = await this.confirmacao.confirmar({
      titulo: 'Inativar parceiro?',
      mensagem:
        'O parceiro deixa de aparecer nas listagens e não pode ser usado em novos lançamentos. O histórico é preservado.',
      rotuloConfirmar: 'Inativar',
      destrutivo: true,
    });
    if (!confirmado) return;

    this.aviso.set(null);
    this.api
      .inactivate(parceiro.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.aviso.set(`Parceiro ${parceiro.legalName} inativado.`);
          this.lista.carregar();
        },
        error: (falha: unknown) => this.lista.erro.set(falha),
      });
  }
}
