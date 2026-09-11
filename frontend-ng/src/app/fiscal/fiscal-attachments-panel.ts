import { Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';

import { FiscalDocumentsApiService } from '../core/api/fiscal-documents-api.service';
import type { FiscalAttachment, FiscalAttachmentCategory, FiscalDocument } from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatDateTime } from '../core/lib/format';
import { Alert } from '../ui/alert';
import { ErrorAlert } from '../ui/error-alert';
import type { OpcaoFiltro } from '../ui/filter-bar';
import { SelectField } from '../ui/select-field';
import { ROTULO_ORIGEM, salvarArquivo, tamanhoArquivo, vinculavel } from './rotulos';

/** Padrão de `UPLOAD_MAX_BYTES` no backend. */
export const LIMITE_ANEXO_BYTES = 10 * 1024 * 1024;
/** Tipos que o storage aceita — conferidos lá pela assinatura do conteúdo. */
const TIPOS_ANEXO = '.pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg';

const OPCOES_CATEGORIA: OpcaoFiltro[] = [
  { value: 'DANFE', label: 'DANFE / espelho da nota' },
  { value: 'ANEXO', label: 'Outro anexo' },
];

/** Metadado do XML em pares legíveis; objetos aninhados ficam de fora. */
export function metadadosLegiveis(metadados: Record<string, unknown>): [string, string][] {
  return Object.entries(metadados ?? {})
    .filter(([, valor]) => ['string', 'number', 'boolean'].includes(typeof valor))
    .map(([chave, valor]) => [chave, String(valor)]);
}

/**
 * Anexos do documento: DANFE/PDF, o XML original e os metadados (RF-044/RF-048
 * — UI-040).
 *
 * Download sempre como arquivo (`Blob` → URL de objeto revogada): as rotas
 * exigem token e empresa, e o backend responde com `attachment` para que nada
 * seja renderizado no contexto da aplicação.
 */
@Component({
  selector: 'sge-fiscal-attachments-panel',
  imports: [FormsModule, ButtonModule, Alert, ErrorAlert, SelectField],
  template: `
    <section class="card secao espaco">
      <h2 class="secao__titulo">Anexos e documento original</h2>

      @if (aviso(); as texto) {
        <div class="bloco"><sge-alert tom="sucesso" [titulo]="texto" /></div>
      }
      @if (problema(); as texto) {
        <div class="bloco"><sge-alert tom="aviso" [titulo]="texto" /></div>
      }
      @if (erro(); as falha) {
        <div class="bloco"><sge-error-alert [erro]="falha" /></div>
      }

      <table class="tabela">
        <thead>
          <tr>
            <th scope="col">Arquivo</th>
            <th scope="col">Tipo</th>
            <th scope="col" class="numero">Tamanho</th>
            <th scope="col">Anexado em</th>
            <th scope="col"></th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>XML original <span class="secundario">como recebido, imutável (RF-044)</span></td>
            <td>XML</td>
            <td class="numero">—</td>
            <td>{{ dataHora(nota().createdAt) }}</td>
            <td class="acoes">
              <p-button
                label="Baixar"
                severity="secondary"
                [text]="true"
                size="small"
                [disabled]="baixando() !== null"
                (onClick)="baixarXml()"
              />
            </td>
          </tr>
          @for (anexo of anexos(); track anexo.id) {
            <tr>
              <td>{{ anexo.fileName }}</td>
              <td>{{ anexo.category === 'DANFE' ? 'DANFE' : 'Anexo' }}</td>
              <td class="numero">{{ tamanho(anexo.sizeBytes) }}</td>
              <td>{{ dataHora(anexo.createdAt) }}</td>
              <td class="acoes">
                <p-button
                  label="Baixar"
                  severity="secondary"
                  [text]="true"
                  size="small"
                  [disabled]="baixando() !== null"
                  (onClick)="baixarAnexo(anexo)"
                />
              </td>
            </tr>
          }
        </tbody>
      </table>
      @if (carregando()) {
        <p class="secundario">Carregando anexos…</p>
      }

      @if (podeAnexar()) {
        <div class="envio">
          <sge-select-field
            rotulo="Tipo do anexo"
            name="categoria"
            [opcoes]="opcoesCategoria"
            [ngModel]="categoria()"
            (ngModelChange)="categoria.set($event ?? 'DANFE')"
          />
          <label class="seletor" [class.seletor--inativo]="enviando()">
            <i class="pi pi-paperclip" aria-hidden="true"></i>
            <span>{{ enviando() ? 'Enviando…' : 'Anexar PDF ou imagem' }}</span>
            <input
              type="file"
              [accept]="tiposAnexo"
              [disabled]="enviando()"
              (change)="anexar($event)"
            />
          </label>
          <span class="secundario">PDF, PNG ou JPEG, até 10 MB.</span>
        </div>
      }

      <h3 class="subtitulo">Metadados</h3>
      <dl class="dados">
        <div>
          <dt>Origem</dt>
          <dd>{{ origem() }}</dd>
        </div>
        <div>
          <dt>Referência na origem</dt>
          <dd>{{ nota().originReference ?? '—' }}</dd>
        </div>
        <div>
          <dt>Coletado em</dt>
          <dd>{{ nota().collectedAt ? dataHora(nota().collectedAt!) : '—' }}</dd>
        </div>
        <div>
          <dt>Importado em</dt>
          <dd>{{ dataHora(nota().createdAt) }}</dd>
        </div>
        <div>
          <dt>Processado em</dt>
          <dd>{{ nota().processedAt ? dataHora(nota().processedAt!) : '—' }}</dd>
        </div>
        <div>
          <dt>Tentativas de processamento</dt>
          <dd>{{ nota().attempts }}</dd>
        </div>
        <div class="dados__largo">
          <dt>Hash SHA-256 do XML</dt>
          <dd class="hash">{{ nota().xmlHash ?? '—' }}</dd>
        </div>
        @for (par of metadados(); track par[0]) {
          <div>
            <dt>{{ par[0] }}</dt>
            <dd>{{ par[1] }}</dd>
          </div>
        }
      </dl>
    </section>
  `,
  styles: `
    .bloco {
      margin-bottom: 0.75rem;
    }
    .subtitulo {
      margin: 1.25rem 0 0.5rem;
      font-size: 0.85rem;
      font-weight: 600;
    }
    .tabela {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.8rem;
    }
    .tabela th,
    .tabela td {
      padding: 0.45rem 0.6rem;
      text-align: left;
      border-bottom: 1px solid var(--p-content-border-color);
    }
    .tabela th {
      color: var(--p-text-muted-color);
      font-weight: 500;
    }
    .tabela .numero {
      text-align: right;
      white-space: nowrap;
    }
    .secundario {
      display: block;
      font-size: 0.7rem;
      color: var(--p-text-muted-color);
    }
    .envio {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: 0.75rem;
      margin-top: 0.75rem;
    }
    .seletor {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.5rem 0.9rem;
      border: 1px dashed var(--p-content-border-color);
      border-radius: 0.4rem;
      font-size: 0.85rem;
      cursor: pointer;
    }
    .seletor input {
      display: none;
    }
    .seletor--inativo {
      opacity: 0.5;
      cursor: not-allowed;
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
      overflow-wrap: anywhere;
    }
    .dados__largo {
      grid-column: 1 / -1;
    }
    .hash {
      font-family: var(--p-font-mono, monospace);
      font-size: 0.75rem;
    }
  `,
})
export class FiscalAttachmentsPanel {
  private readonly api = inject(FiscalDocumentsApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly destroyRef = inject(DestroyRef);

  readonly nota = input.required<FiscalDocument>();

  protected readonly opcoesCategoria = OPCOES_CATEGORIA;
  protected readonly tiposAnexo = TIPOS_ANEXO;

  protected readonly anexos = signal<FiscalAttachment[]>([]);
  protected readonly carregando = signal(false);
  protected readonly enviando = signal(false);
  /** Id do arquivo em download (`'xml'` para o original). */
  protected readonly baixando = signal<string | null>(null);
  protected readonly categoria = signal<FiscalAttachmentCategory>('DANFE');
  protected readonly aviso = signal<string | null>(null);
  /** Recusa local, antes de gastar o upload. */
  protected readonly problema = signal<string | null>(null);
  protected readonly erro = signal<unknown>(null);

  protected readonly podeAnexar = computed(
    () => this.permissoes.pode('fiscal-documents:UPDATE') && vinculavel(this.nota()),
  );

  protected readonly origem = computed(() => ROTULO_ORIGEM[this.nota().origin] ?? this.nota().origin);
  protected readonly metadados = computed(() => metadadosLegiveis(this.nota().metadata));

  constructor() {
    // Recarrega só quando muda o documento — não a cada vínculo salvo nele.
    let atual: string | null = null;
    effect(() => {
      const id = this.nota().id;
      if (id === atual) return;
      atual = id;
      untracked(() => this.carregar(id));
    });
  }

  protected anexar(evento: Event): void {
    const entrada = evento.target as HTMLInputElement;
    const arquivo = entrada.files?.[0];
    entrada.value = '';
    if (!arquivo || this.enviando()) return;

    this.aviso.set(null);
    this.erro.set(null);
    this.problema.set(null);
    if (arquivo.size > LIMITE_ANEXO_BYTES) {
      this.problema.set(`${arquivo.name} passa do limite de 10 MB.`);
      return;
    }

    this.enviando.set(true);
    this.api
      .attach(this.nota().id, arquivo, this.categoria())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (anexo) => {
          this.enviando.set(false);
          this.anexos.update((lista) => [...lista, anexo]);
          this.aviso.set(`${anexo.fileName} anexado.`);
        },
        error: (falha: unknown) => {
          this.enviando.set(false);
          this.erro.set(falha);
        },
      });
  }

  protected baixarXml(): void {
    const nota = this.nota();
    this.baixar('xml', this.api.downloadXml(nota.id), `${nota.accessKey ?? nota.number}.xml`);
  }

  protected baixarAnexo(anexo: FiscalAttachment): void {
    this.baixar(anexo.id, this.api.downloadAttachment(this.nota().id, anexo.id), anexo.fileName);
  }

  private baixar(chave: string, requisicao: ReturnType<FiscalDocumentsApiService['downloadXml']>, nome: string) {
    if (this.baixando()) return;
    this.baixando.set(chave);
    this.erro.set(null);
    requisicao.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (conteudo) => {
        this.baixando.set(null);
        salvarArquivo(conteudo, nome);
      },
      error: (falha: unknown) => {
        this.baixando.set(null);
        this.erro.set(falha);
      },
    });
  }

  private carregar(id: string): void {
    this.carregando.set(true);
    this.api
      .listAttachments(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (lista) => {
          this.carregando.set(false);
          this.anexos.set(lista);
        },
        error: (falha: unknown) => {
          this.carregando.set(false);
          this.erro.set(falha);
        },
      });
  }

  protected dataHora(valor: string): string {
    return formatDateTime(valor);
  }

  protected tamanho(bytes: number | null): string {
    return tamanhoArquivo(bytes);
  }
}
