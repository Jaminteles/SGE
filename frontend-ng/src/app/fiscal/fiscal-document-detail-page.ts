import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { TagModule } from 'primeng/tag';

import { FiscalDocumentsApiService } from '../core/api/fiscal-documents-api.service';
import type { FiscalDocument, FiscalDocumentItem } from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatCurrency, formatDecimal } from '../core/lib/decimal';
import { formatDate, formatDateTime } from '../core/lib/format';
import { CASAS_UNITARIAS } from '../compras/calculo';
import { Alert } from '../ui/alert';
import { ErrorAlert } from '../ui/error-alert';
import { TextField } from '../ui/text-field';
import { FiscalAttachmentsPanel } from './fiscal-attachments-panel';
import { FiscalDuplicatePanel } from './fiscal-duplicate-panel';
import { FiscalLinksPanel } from './fiscal-links-panel';
import {
  ROTULO_MODELO,
  ROTULO_ORIGEM,
  ROTULO_RESULTADO,
  ROTULO_STATUS_NOTA,
  descartavel,
  emitente,
  formatarChave,
  formatarDocumento,
  numeroNota,
  reprocessavel,
  severidadeNota,
} from './rotulos';

/** Mínimo do motivo de descarte (`CancelFiscalDocumentDto`). */
const MOTIVO_MINIMO = 5;

/**
 * Detalhe do documento fiscal (RF-045 — UI-037) e as decisões sobre ele:
 * duplicidade (UI-038), vínculos e efeitos (UI-039), anexos (UI-040) e
 * reprocessamento (UI-041).
 *
 * O conteúdo fiscal é somente leitura: vem do XML e é imutável (bd/12). O que
 * se decide aqui são vínculos, efeitos e descarte — cada um conferido de novo
 * pelo backend.
 */
@Component({
  selector: 'sge-fiscal-document-detail-page',
  imports: [
    FormsModule,
    RouterLink,
    ButtonModule,
    DialogModule,
    TagModule,
    Alert,
    ErrorAlert,
    TextField,
    FiscalAttachmentsPanel,
    FiscalDuplicatePanel,
    FiscalLinksPanel,
  ],
  template: `
    <p class="crumb">Fiscal / Documentos / {{ titulo() }}</p>

    <div class="pagehead">
      <div>
        <h1>{{ titulo() }}</h1>
        <p>{{ subtitulo() }}</p>
      </div>
      <div class="pagehead__actions">
        <p-button
          label="Voltar"
          severity="secondary"
          [outlined]="true"
          routerLink="/fiscal/documentos"
        />
        @if (nota(); as registro) {
          @if (podeAtualizar() && reprocessavel(registro)) {
            <p-button
              label="Reprocessar"
              icon="pi pi-refresh"
              [loading]="agindo()"
              [disabled]="agindo()"
              (onClick)="reprocessar()"
            />
          }
          @if (podeDescartar() && descartavel(registro)) {
            <p-button
              label="Descartar"
              severity="danger"
              [outlined]="true"
              [disabled]="agindo()"
              (onClick)="abrirDescarte('')"
            />
          }
        }
      </div>
    </div>

    @if (aviso(); as texto) {
      <div class="espaco"><sge-alert tom="sucesso" [titulo]="texto" /></div>
    }
    @if (erro(); as falha) {
      <div class="espaco"><sge-error-alert [erro]="falha" /></div>
    }

    @if (nota(); as registro) {
      @if (registro.status === 'ERRO') {
        <div class="espaco">
          <sge-alert
            tom="erro"
            titulo="O documento não fechou no processamento"
            [mensagem]="
              (registro.processingError ?? 'Motivo não informado.') +
              ' Corrija o cadastro (fornecedor, produto) e reprocesse: o mesmo XML é lido de novo.'
            "
          />
        </div>
      }
      @if (registro.status === 'CANCELADO') {
        <div class="espaco">
          <sge-alert
            tom="info"
            titulo="Documento descartado"
            mensagem="O registro é preservado; o motivo está na trilha de auditoria (RF-049)."
          />
        </div>
      }
      @if (registro.status === 'DUPLICADO') {
        <sge-fiscal-duplicate-panel
          [nota]="registro"
          [podeDescartar]="podeDescartar() && descartavel(registro)"
          (descartar)="abrirDescarte($event)"
        />
      }

      <div class="kpis espaco">
        <div class="kpi">
          <p class="kpi__label">Valor total</p>
          <p class="kpi__value">{{ moeda(registro.totalAmount) }}</p>
        </div>
        <div class="kpi">
          <p class="kpi__label">Itens</p>
          <p class="kpi__value">{{ registro.items.length }}</p>
        </div>
        <div class="kpi">
          <p class="kpi__label">Situação</p>
          <p class="kpi__value kpi__value--texto">
            <p-tag
              [value]="situacao(registro)"
              [severity]="severidade(registro)"
              [rounded]="true"
            />
          </p>
        </div>
        <div class="kpi">
          <p class="kpi__label">Efeitos</p>
          <p class="kpi__value kpi__value--texto">
            {{ registro.generatedStock ? 'Estoque' : 'Sem estoque' }} ·
            {{ registro.generatedPayable ? 'Título a pagar' : 'Sem título' }}
          </p>
        </div>
      </div>

      <section class="card secao espaco">
        <h2 class="secao__titulo">Identificação</h2>
        <dl class="dados">
          <div class="dados__largo">
            <dt>Chave de acesso</dt>
            <dd class="chave">{{ chave(registro.accessKey) }}</dd>
          </div>
          <div>
            <dt>Modelo</dt>
            <dd>{{ modelo(registro) }}</dd>
          </div>
          <div>
            <dt>Número / série</dt>
            <dd>{{ numero(registro) }}</dd>
          </div>
          <div>
            <dt>Operação</dt>
            <dd>{{ operacao(registro.operationType) }}</dd>
          </div>
          <div>
            <dt>Natureza da operação</dt>
            <dd>{{ registro.operationNature ?? '—' }}</dd>
          </div>
          <div>
            <dt>Emissão</dt>
            <dd>{{ dataHora(registro.issuedAt) }}</dd>
          </div>
          <div>
            <dt>Entrada / saída</dt>
            <dd>{{ registro.movedAt ? dataHora(registro.movedAt) : '—' }}</dd>
          </div>
          <div>
            <dt>Origem</dt>
            <dd>{{ origem(registro) }}</dd>
          </div>
          <div>
            <dt>Filial</dt>
            <dd>{{ registro.branch ? registro.branch.code + ' — ' + registro.branch.name : '—' }}</dd>
          </div>
        </dl>
      </section>

      <div class="duas-colunas espaco">
        <section class="card secao">
          <h2 class="secao__titulo">Emitente</h2>
          <dl class="dados">
            <div class="dados__largo">
              <dt>Nome no XML</dt>
              <dd>{{ registro.issuerName ?? '—' }}</dd>
            </div>
            <div>
              <dt>CNPJ / CPF</dt>
              <dd>{{ documento(registro.issuerTaxId) }}</dd>
            </div>
            <div>
              <dt>Fornecedor vinculado</dt>
              <dd>{{ registro.issuerPartner ? nomeEmitente(registro) : 'Não vinculado' }}</dd>
            </div>
          </dl>
        </section>
        <section class="card secao">
          <h2 class="secao__titulo">Destinatário</h2>
          <dl class="dados">
            <div class="dados__largo">
              <dt>Nome no XML</dt>
              <dd>{{ registro.recipientName ?? '—' }}</dd>
            </div>
            <div>
              <dt>CNPJ / CPF</dt>
              <dd>{{ documento(registro.recipientTaxId) }}</dd>
            </div>
            <div>
              <dt>Parceiro</dt>
              <dd>
                {{
                  registro.recipientPartner
                    ? (registro.recipientPartner.tradeName ?? registro.recipientPartner.legalName)
                    : '—'
                }}
              </dd>
            </div>
          </dl>
        </section>
      </div>

      <div class="duas-colunas espaco">
        <section class="card secao">
          <h2 class="secao__titulo">Valores</h2>
          <dl class="valores">
            <dt>Produtos</dt>
            <dd>{{ moeda(registro.productsAmount) }}</dd>
            <dt>Desconto</dt>
            <dd>{{ moeda(registro.discountAmount) }}</dd>
            <dt>Frete</dt>
            <dd>{{ moeda(registro.freightAmount) }}</dd>
            <dt>Seguro</dt>
            <dd>{{ moeda(registro.insuranceAmount) }}</dd>
            <dt>Outras despesas</dt>
            <dd>{{ moeda(registro.otherExpenseAmount) }}</dd>
            <dt class="total">Total da nota</dt>
            <dd class="total">{{ moeda(registro.totalAmount) }}</dd>
          </dl>
        </section>
        <section class="card secao">
          <h2 class="secao__titulo">Tributos declarados</h2>
          <dl class="valores">
            <dt>ICMS</dt>
            <dd>{{ moeda(registro.icmsAmount) }}</dd>
            <dt>ICMS-ST</dt>
            <dd>{{ moeda(registro.icmsStAmount) }}</dd>
            <dt>IPI</dt>
            <dd>{{ moeda(registro.ipiAmount) }}</dd>
            <dt>PIS</dt>
            <dd>{{ moeda(registro.pisAmount) }}</dd>
            <dt>COFINS</dt>
            <dd>{{ moeda(registro.cofinsAmount) }}</dd>
            <dt>ISS</dt>
            <dd>{{ moeda(registro.issAmount) }}</dd>
          </dl>
        </section>
      </div>

      <section class="card table-card espaco">
        <h2 class="secao__titulo secao__titulo--tabela">Itens</h2>
        @if (registro.items.length === 0) {
          <p class="vazio">
            Sem itens registrados: as linhas só entram quando fecham com o total (RF-045).
          </p>
        } @else {
          <div class="rolagem">
            <table class="tabela">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Código</th>
                  <th scope="col">Descrição</th>
                  <th scope="col">NCM</th>
                  <th scope="col">CFOP</th>
                  <th scope="col">Un.</th>
                  <th scope="col" class="numero">Qtd.</th>
                  <th scope="col" class="numero">Unitário</th>
                  <th scope="col" class="numero">Total</th>
                  <th scope="col" class="numero">ICMS</th>
                  <th scope="col" class="numero">IPI</th>
                  <th scope="col" class="numero">PIS / COFINS</th>
                  <th scope="col">Produto</th>
                </tr>
              </thead>
              <tbody>
                @for (linha of registro.items; track linha.id) {
                  <tr>
                    <td>{{ linha.sequence }}</td>
                    <td>{{ linha.supplierCode ?? '—' }}</td>
                    <td>{{ linha.description }}</td>
                    <td>{{ linha.ncm ?? '—' }}</td>
                    <td>{{ linha.cfop ?? '—' }}</td>
                    <td>{{ linha.unit ?? '—' }}</td>
                    <td class="numero">{{ unitario(linha.quantity) }}</td>
                    <td class="numero">{{ unitario(linha.unitPrice) }}</td>
                    <td class="numero">{{ moeda(linha.lineAmount) }}</td>
                    <td class="numero">
                      {{ moeda(linha.icmsAmount) }}
                      <span class="secundario">{{ icms(linha) }}</span>
                    </td>
                    <td class="numero">{{ moeda(linha.ipiAmount) }}</td>
                    <td class="numero">
                      {{ moeda(linha.pisAmount) }}
                      <span class="secundario">{{ moeda(linha.cofinsAmount) }}</span>
                    </td>
                    <td>
                      {{ linha.product ? linha.product.code + ' — ' + linha.product.description : '—' }}
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>

      <sge-fiscal-links-panel [nota]="registro" (atualizada)="aoAtualizar($event)" />

      <sge-fiscal-attachments-panel [nota]="registro" />
    }

    <p-dialog
      [visible]="descarteAberto()"
      (visibleChange)="descarteAberto.set($event)"
      [modal]="true"
      [style]="{ width: '36rem' }"
      header="Descartar documento"
    >
      <form class="grade-campos formulario" (ngSubmit)="descartar()">
        <sge-text-field
          rotulo="Motivo"
          name="motivoDescarte"
          [obrigatorio]="true"
          dica="O documento é preservado; o motivo fica na trilha de auditoria (RF-049)"
          [ngModel]="motivo()"
          (ngModelChange)="motivo.set($event)"
        />
      </form>
      <ng-template #footer>
        <p-button
          label="Voltar"
          severity="secondary"
          [outlined]="true"
          (onClick)="descarteAberto.set(false)"
        />
        <p-button
          label="Descartar documento"
          severity="danger"
          [loading]="agindo()"
          [disabled]="!motivoValido()"
          (onClick)="descartar()"
        />
      </ng-template>
    </p-dialog>
  `,
  styles: `
    .formulario {
      padding-top: 0.75rem;
    }
    .dados {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
      gap: 0.75rem 1.5rem;
      margin: 0;
      font-size: 0.85rem;
    }
    .dados dt {
      font-size: 0.75rem;
      color: var(--p-text-muted-color);
    }
    .dados dd {
      margin: 0.2rem 0 0;
    }
    .dados__largo {
      grid-column: 1 / -1;
    }
    .chave {
      font-family: var(--p-font-mono, monospace);
      letter-spacing: 0.02em;
    }
    .duas-colunas {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
      gap: 1rem;
    }
    .valores {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 0.35rem 1rem;
      margin: 0;
      font-size: 0.85rem;
    }
    .valores dt {
      color: var(--p-text-muted-color);
    }
    .valores dd {
      margin: 0;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .valores .total {
      font-weight: 600;
      color: var(--p-text-color);
      border-top: 1px solid var(--p-content-border-color);
      padding-top: 0.35rem;
    }
    .kpi__value--texto {
      font-size: 0.95rem;
    }
    .secao__titulo--tabela {
      padding: 1rem 1rem 0;
    }
    .vazio {
      padding: 1rem;
      margin: 0;
      color: var(--p-text-muted-color);
      font-size: 0.85rem;
    }
    .rolagem {
      overflow-x: auto;
    }
    .tabela {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.8rem;
    }
    .tabela th,
    .tabela td {
      padding: 0.5rem 0.6rem;
      text-align: left;
      border-bottom: 1px solid var(--p-content-border-color);
    }
    .tabela th {
      color: var(--p-text-muted-color);
      font-weight: 500;
    }
    .tabela .numero {
      text-align: right;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .secundario {
      display: block;
      font-size: 0.7rem;
      color: var(--p-text-muted-color);
    }
  `,
})
export class FiscalDocumentDetailPage {
  private readonly api = inject(FiscalDocumentsApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly rota = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly documentId = this.rota.snapshot.paramMap.get('id') ?? '';

  protected readonly nota = signal<FiscalDocument | null>(null);
  protected readonly erro = signal<unknown>(null);
  protected readonly aviso = signal<string | null>(null);
  protected readonly agindo = signal(false);
  protected readonly descarteAberto = signal(false);
  protected readonly motivo = signal('');

  protected readonly podeAtualizar = () => this.permissoes.pode('fiscal-documents:UPDATE');
  protected readonly podeDescartar = () => this.permissoes.pode('fiscal-documents:DELETE');
  protected readonly reprocessavel = reprocessavel;
  protected readonly descartavel = descartavel;

  protected readonly motivoValido = computed(
    () => !this.agindo() && this.motivo().trim().length >= MOTIVO_MINIMO,
  );

  protected readonly titulo = computed(() => {
    const registro = this.nota();
    if (!registro) return 'Documento fiscal';
    return `${ROTULO_MODELO[registro.model] ?? registro.model} ${numeroNota(registro)}`;
  });

  protected readonly subtitulo = computed(() => {
    const registro = this.nota();
    if (!registro) return 'Chave, emitente, destinatário, itens, valores e tributos (RF-045).';
    return `${emitente(registro)} · ${ROTULO_STATUS_NOTA[registro.status]} · emitida em ${formatDate(registro.issuedAt)}.`;
  });

  constructor() {
    this.api
      .get(this.documentId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (registro) => this.nota.set(registro),
        error: (falha: unknown) => this.erro.set(falha),
      });
  }

  /** Vínculo salvo ou efeito gerado num dos painéis: o documento volta atualizado. */
  protected aoAtualizar(registro: FiscalDocument): void {
    this.nota.set(registro);
    this.erro.set(null);
  }

  protected reprocessar(): void {
    if (this.agindo()) return;
    this.agindo.set(true);
    this.erro.set(null);
    this.aviso.set(null);
    this.api
      .reprocess(this.documentId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (resultado) => {
          this.agindo.set(false);
          this.nota.set(resultado.document);
          this.aviso.set(
            resultado.outcome === 'IMPORTADO'
              ? 'Documento reprocessado e processado.'
              : `Reprocessado: ${ROTULO_RESULTADO[resultado.outcome].toLowerCase()}.`,
          );
        },
        error: (falha: unknown) => {
          this.agindo.set(false);
          this.erro.set(falha);
        },
      });
  }

  /** `sugestao` vem do painel de duplicidade, que já sabe dizer o porquê. */
  protected abrirDescarte(sugestao: string): void {
    this.motivo.set(sugestao);
    this.descarteAberto.set(true);
  }

  protected descartar(): void {
    const motivo = this.motivo().trim();
    if (!this.motivoValido()) return;
    this.descarteAberto.set(false);
    this.agindo.set(true);
    this.erro.set(null);
    this.aviso.set(null);
    this.api
      .cancel(this.documentId, motivo)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (registro) => {
          this.agindo.set(false);
          this.nota.set(registro);
          this.aviso.set('Documento descartado; o registro foi preservado.');
        },
        error: (falha: unknown) => {
          this.agindo.set(false);
          this.erro.set(falha);
        },
      });
  }

  protected moeda(valor: string): string {
    return formatCurrency(valor);
  }

  protected unitario(valor: string): string {
    return formatDecimal(valor, CASAS_UNITARIAS);
  }

  protected icms(linha: FiscalDocumentItem): string {
    const cst = linha.icmsCst ? `CST ${linha.icmsCst} · ` : '';
    return `${cst}${formatDecimal(linha.icmsRate)}%`;
  }

  protected dataHora(valor: string): string {
    return formatDateTime(valor);
  }

  protected chave(valor: string | null): string {
    return formatarChave(valor);
  }

  protected documento(valor: string | null): string {
    return formatarDocumento(valor);
  }

  protected operacao(tipo: string | null): string {
    if (tipo === '0') return 'Entrada';
    if (tipo === '1') return 'Saída';
    return '—';
  }

  protected numero(registro: FiscalDocument): string {
    return numeroNota(registro);
  }

  protected modelo(registro: FiscalDocument): string {
    return ROTULO_MODELO[registro.model] ?? registro.model;
  }

  protected origem(registro: FiscalDocument): string {
    return ROTULO_ORIGEM[registro.origin] ?? registro.origin;
  }

  protected nomeEmitente(registro: FiscalDocument): string {
    return emitente(registro);
  }

  protected situacao(registro: FiscalDocument): string {
    return ROTULO_STATUS_NOTA[registro.status];
  }

  protected severidade(registro: FiscalDocument) {
    return severidadeNota(registro.status);
  }
}
