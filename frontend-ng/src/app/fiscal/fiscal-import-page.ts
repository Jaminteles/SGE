import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';

import { BranchesApiService } from '../core/api/branches-api.service';
import { errorMessage } from '../core/api/errors';
import { FiscalDocumentsApiService } from '../core/api/fiscal-documents-api.service';
import type { FiscalImportOutcome } from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { Alert } from '../ui/alert';
import type { OpcaoFiltro } from '../ui/filter-bar';
import { SelectField } from '../ui/select-field';
import { TextField } from '../ui/text-field';
import { ROTULO_RESULTADO, numeroNota, severidadeResultado, tamanhoArquivo } from './rotulos';

/** Teto do leitor de XML do backend (`DEFAULT_XML_LIMITS.maxBytes`). */
export const LIMITE_XML_BYTES = 2 * 1024 * 1024;
/** Arquivos por fila — o mesmo teto do lote da coleta (`MAX_COLLECT_BATCH`). */
export const LIMITE_FILA = 50;

export type EstadoFila = 'AGUARDANDO' | 'ENVIANDO' | 'CONCLUIDO' | 'RECUSADO';

export interface ItemFila {
  chave: number;
  arquivo: File;
  estado: EstadoFila;
  resultado: FiscalImportOutcome | null;
  documento: { id: string; number: string; series: string | null } | null;
  motivo: string | null;
}

/**
 * O que dá para recusar antes de gastar uma requisição: extensão, arquivo
 * vazio e tamanho. O conteúdo quem julga é o leitor do backend.
 */
export function problemaArquivo(arquivo: File): string | null {
  if (!arquivo.name.toLowerCase().endsWith('.xml')) return 'Não é um arquivo .xml.';
  if (arquivo.size === 0) return 'Arquivo vazio.';
  if (arquivo.size > LIMITE_XML_BYTES) return 'Maior que o limite de 2 MB.';
  return null;
}

let sequencia = 0;

/**
 * Importação de XML com fila de processamento (RF-043/RF-049 — UI-036).
 *
 * A importação no backend é síncrona e devolve o resultado de cada arquivo;
 * a fila é da tela: os arquivos seguem **um por vez**, e cada linha mostra a
 * sua situação — aguardando, enviando, importado, já conhecido, duplicado, em
 * erro ou recusado. Um arquivo ruim não interrompe os demais, e mandar em série
 * evita disputar o servidor com dezenas de uploads simultâneos.
 */
@Component({
  selector: 'sge-fiscal-import-page',
  imports: [FormsModule, RouterLink, ButtonModule, TagModule, Alert, SelectField, TextField],
  template: `
    <p class="crumb">Fiscal / Importar XML</p>

    <div class="pagehead">
      <div>
        <h1>Importar XML</h1>
        <p>
          NF-e e NFC-e em XML. Número, chave, emitente, itens e valores vêm do próprio arquivo
          (RF-043 a RF-046).
        </p>
      </div>
      <div class="pagehead__actions">
        <p-button
          label="Documentos"
          severity="secondary"
          [outlined]="true"
          routerLink="/fiscal/documentos"
        />
      </div>
    </div>

    <section class="card secao espaco">
      <div class="grade-campos">
        @if (podeLerFiliais()) {
          <sge-select-field
            rotulo="Filial que recebeu"
            name="branchId"
            dica="Opcional — vale para todos os arquivos desta fila"
            [opcoes]="opcoesFilial()"
            [ngModel]="filial() || null"
            (ngModelChange)="filial.set($event ?? '')"
          />
        }
        <sge-text-field
          rotulo="Observação"
          name="note"
          dica="Opcional, até 500 caracteres"
          [ngModel]="observacao()"
          (ngModelChange)="observacao.set($event)"
        />
      </div>

      <div class="acoes-fila">
        <label class="seletor" [class.seletor--inativo]="processando()">
          <i class="pi pi-plus" aria-hidden="true"></i>
          <span>Adicionar arquivos</span>
          <input
            type="file"
            accept=".xml,text/xml,application/xml"
            multiple
            [disabled]="processando()"
            (change)="adicionarArquivos($event)"
          />
        </label>
        <p-button
          label="Importar fila"
          icon="pi pi-upload"
          [loading]="processando()"
          [disabled]="processando() || resumo().aguardando === 0"
          (onClick)="iniciar()"
        />
        <p-button
          label="Limpar concluídos"
          severity="secondary"
          [outlined]="true"
          [disabled]="processando() || fila().length === resumo().aguardando"
          (onClick)="limparConcluidos()"
        />
      </div>
    </section>

    @if (aviso(); as texto) {
      <div class="espaco"><sge-alert tom="aviso" [titulo]="texto" /></div>
    }
    @if (resumo().duplicados > 0) {
      <div class="espaco">
        <sge-alert
          tom="aviso"
          titulo="Documento duplicado na fila"
          mensagem="A mesma chave de acesso já existe com conteúdo diferente. A duplicata foi registrada sem efeito; abra-a para comparar com o original e decidir (RF-046)."
        />
      </div>
    }

    <div class="kpis espaco">
      <div class="kpi">
        <p class="kpi__label">Aguardando</p>
        <p class="kpi__value">{{ resumo().aguardando }}</p>
      </div>
      <div class="kpi">
        <p class="kpi__label">Importados</p>
        <p class="kpi__value">{{ resumo().importados }}</p>
      </div>
      <div class="kpi">
        <p class="kpi__label">Duplicados</p>
        <p class="kpi__value">{{ resumo().duplicados }}</p>
      </div>
      <div class="kpi">
        <p class="kpi__label">Com erro / recusados</p>
        <p class="kpi__value">{{ resumo().comErro }} / {{ resumo().recusados }}</p>
      </div>
    </div>

    <section class="card table-card espaco">
      @if (fila().length === 0) {
        <p class="vazio">Nenhum arquivo na fila. Adicione até {{ limiteFila }} XML por vez.</p>
      } @else {
        <table class="tabela">
          <thead>
            <tr>
              <th scope="col">Arquivo</th>
              <th scope="col" class="numero">Tamanho</th>
              <th scope="col">Situação</th>
              <th scope="col">Documento</th>
              <th scope="col">Detalhe</th>
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>
            @for (item of fila(); track item.chave) {
              <tr>
                <td>{{ item.arquivo.name }}</td>
                <td class="numero">{{ tamanho(item.arquivo.size) }}</td>
                <td>
                  <p-tag
                    [value]="rotuloEstado(item)"
                    [severity]="severidadeEstado(item)"
                    [rounded]="true"
                  />
                </td>
                <td>
                  @if (item.documento; as nota) {
                    <a [routerLink]="['/fiscal/documentos', nota.id]">{{ numero(nota) }}</a>
                  } @else {
                    —
                  }
                </td>
                <td class="detalhe">{{ item.motivo ?? '—' }}</td>
                <td class="acoes">
                  @if (item.estado !== 'ENVIANDO' && !processando()) {
                    <p-button
                      label="Remover"
                      severity="secondary"
                      [text]="true"
                      size="small"
                      (onClick)="remover(item.chave)"
                    />
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      }
    </section>
  `,
  styles: `
    .acoes-fila {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      align-items: center;
      margin-top: 1rem;
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
    .vazio {
      padding: 1.5rem;
      margin: 0;
      color: var(--p-text-muted-color);
      font-size: 0.85rem;
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
      white-space: nowrap;
    }
    .detalhe {
      max-width: 28rem;
      color: var(--p-text-muted-color);
    }
  `,
})
export class FiscalImportPage {
  private readonly api = inject(FiscalDocumentsApiService);
  private readonly filiais = inject(BranchesApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly limiteFila = LIMITE_FILA;

  protected readonly fila = signal<ItemFila[]>([]);
  protected readonly processando = signal(false);
  protected readonly aviso = signal<string | null>(null);
  protected readonly filial = signal('');
  protected readonly observacao = signal('');
  protected readonly opcoesFilial = signal<OpcaoFiltro[]>([]);

  protected readonly podeLerFiliais = () => this.permissoes.pode('branches:READ');

  protected readonly resumo = computed(() => {
    const itens = this.fila();
    const com = (resultado: FiscalImportOutcome) =>
      itens.filter((item) => item.resultado === resultado).length;
    return {
      aguardando: itens.filter((item) => item.estado === 'AGUARDANDO').length,
      importados: com('IMPORTADO') + com('JA_IMPORTADO'),
      duplicados: com('DUPLICADO'),
      comErro: com('ERRO'),
      recusados: itens.filter((item) => item.estado === 'RECUSADO').length,
    };
  });

  constructor() {
    if (this.podeLerFiliais()) {
      this.filiais
        .list({ pageSize: 100 })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (r) =>
            this.opcoesFilial.set(
              r.data.map((f) => ({ value: f.id, label: `${f.code} — ${f.name}` })),
            ),
          error: () => this.opcoesFilial.set([]),
        });
    }
  }

  protected adicionarArquivos(evento: Event): void {
    const entrada = evento.target as HTMLInputElement;
    const arquivos = Array.from(entrada.files ?? []);
    entrada.value = '';

    const vagas = LIMITE_FILA - this.fila().length;
    const aceitos = arquivos.slice(0, Math.max(vagas, 0));
    this.aviso.set(
      arquivos.length > aceitos.length
        ? `A fila aceita até ${LIMITE_FILA} arquivos; ${arquivos.length - aceitos.length} ficaram de fora.`
        : null,
    );

    const novos: ItemFila[] = aceitos.map((arquivo) => {
      const problema = problemaArquivo(arquivo);
      return {
        chave: ++sequencia,
        arquivo,
        estado: problema ? 'RECUSADO' : 'AGUARDANDO',
        resultado: null,
        documento: null,
        motivo: problema,
      };
    });
    this.fila.update((atual) => [...atual, ...novos]);
  }

  protected iniciar(): void {
    if (this.processando()) return;
    this.processando.set(true);
    this.proximo();
  }

  protected remover(chave: number): void {
    if (this.processando()) return;
    this.fila.update((atual) => atual.filter((item) => item.chave !== chave));
  }

  protected limparConcluidos(): void {
    if (this.processando()) return;
    this.fila.update((atual) => atual.filter((item) => item.estado === 'AGUARDANDO'));
  }

  /** Envia o próximo da fila; a resposta (qualquer que seja) chama o seguinte. */
  private proximo(): void {
    const item = this.fila().find((candidato) => candidato.estado === 'AGUARDANDO');
    if (!item) {
      this.processando.set(false);
      return;
    }

    this.atualizar(item.chave, { estado: 'ENVIANDO' });
    const branchId = this.filial() || undefined;
    const note = this.observacao().trim() || undefined;

    this.api
      .importXml(item.arquivo, { branchId, note })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (resultado) => {
          this.atualizar(item.chave, {
            estado: 'CONCLUIDO',
            resultado: resultado.outcome,
            documento: {
              id: resultado.document.id,
              number: resultado.document.number,
              series: resultado.document.series,
            },
            motivo: resultado.reason ?? null,
          });
          this.proximo();
        },
        error: (falha: unknown) => {
          this.atualizar(item.chave, { estado: 'RECUSADO', motivo: errorMessage(falha) });
          this.proximo();
        },
      });
  }

  private atualizar(chave: number, mudanca: Partial<ItemFila>): void {
    this.fila.update((atual) =>
      atual.map((item) => (item.chave === chave ? { ...item, ...mudanca } : item)),
    );
  }

  protected rotuloEstado(item: ItemFila): string {
    if (item.estado === 'AGUARDANDO') return 'Aguardando';
    if (item.estado === 'ENVIANDO') return 'Enviando…';
    if (item.estado === 'RECUSADO') return 'Recusado';
    return item.resultado ? ROTULO_RESULTADO[item.resultado] : 'Concluído';
  }

  protected severidadeEstado(item: ItemFila) {
    if (item.estado === 'RECUSADO') return 'danger';
    if (item.estado !== 'CONCLUIDO' || !item.resultado) return 'secondary';
    return severidadeResultado(item.resultado);
  }

  protected tamanho(bytes: number): string {
    return tamanhoArquivo(bytes);
  }

  protected numero(nota: { number: string; series: string | null }): string {
    return numeroNota(nota);
  }
}
