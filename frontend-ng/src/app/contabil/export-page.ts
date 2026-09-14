import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';

import { AccountingApiService } from '../core/api/accounting-api.service';
import type { AccountingExportFormat } from '../core/api/types';
import { hoje } from '../financeiro/dinheiro';
import { salvarArquivo } from '../fiscal/rotulos';
import { Alert } from '../ui/alert';
import { ErrorAlert } from '../ui/error-alert';
import { SelectField } from '../ui/select-field';
import { TextField } from '../ui/text-field';
import { mesDaData, problemaRecorte } from './rotulos';

const OPCOES_FORMATO: { value: AccountingExportFormat; label: string }[] = [
  { value: 'csv', label: 'CSV (planilha / importação)' },
  { value: 'json', label: 'JSON (integração)' },
];

/**
 * Exportação de dados contábeis para sistemas externos (RF-087 — UI-060).
 *
 * O arquivo sai por `POST` com token e empresa, e chega como `Blob`: não existe
 * link direto para o dado da empresa. Marcar como exportado é opcional e fica
 * separado de gerar — conferir o lote antes de assumir que foi entregue evita
 * que a próxima exportação "só pendentes" pule lançamentos que nunca chegaram.
 */
@Component({
  selector: 'sge-export-page',
  imports: [FormsModule, ButtonModule, CheckboxModule, Alert, ErrorAlert, SelectField, TextField],
  template: `
    <p class="crumb">Contábil / Exportação</p>

    <div class="pagehead">
      <div>
        <h1>Exportação contábil</h1>
        <p>Lançamentos e partidas do período para o sistema do contador (RF-087).</p>
      </div>
    </div>

    @if (resultado(); as r) {
      <sge-alert
        tom="sucesso"
        [titulo]="'Arquivo ' + r.arquivo + ' gerado.'"
        [mensagem]="r.resumo"
      />
    }

    @if (erro(); as falha) {
      <div class="espaco"><sge-error-alert [erro]="falha" /></div>
    }

    <section class="card secao espaco">
      <div class="grade-campos">
        <sge-text-field rotulo="Competência de" tipo="date" [obrigatorio]="true" [ngModel]="de()" (ngModelChange)="de.set($event ?? '')" />
        <sge-text-field rotulo="Até" tipo="date" [obrigatorio]="true" [ngModel]="ate()" (ngModelChange)="ate.set($event ?? '')" />
        <sge-select-field
          rotulo="Formato"
          [obrigatorio]="true"
          [opcoes]="opcoesFormato"
          [ngModel]="formato()"
          (ngModelChange)="formato.set($event ?? 'csv')"
        />
      </div>

      <label class="marcador">
        <p-checkbox [binary]="true" [ngModel]="somentePendentes()" (ngModelChange)="somentePendentes.set($event)" />
        Somente lançamentos ainda não exportados
      </label>
      <label class="marcador">
        <p-checkbox [binary]="true" [ngModel]="marcar()" (ngModelChange)="marcar.set($event)" />
        Marcar os lançamentos como exportados
      </label>

      @if (marcar()) {
        <sge-alert
          tom="aviso"
          titulo="A marcação não se desfaz por aqui"
          mensagem="Lançamentos marcados saem das próximas exportações de pendentes. Sem marcar, a exportação é só leitura — útil para conferir o lote antes."
        />
      }

      @if (problema(); as texto) {
        <p class="campo__erro">{{ texto }}</p>
      }

      <div class="acoes">
        <p-button
          label="Gerar arquivo"
          icon="pi pi-download"
          [loading]="gerando()"
          [disabled]="gerando() || !!problema()"
          (onClick)="exportar()"
        />
      </div>
    </section>
  `,
  styles: `
    .marcador {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin: 0.5rem 0;
      font-size: 0.85rem;
    }
  `,
})
export class ExportPage {
  private readonly api = inject(AccountingApiService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly opcoesFormato = OPCOES_FORMATO;

  protected readonly de = signal(mesDaData(hoje()).de);
  protected readonly ate = signal(mesDaData(hoje()).ate);
  protected readonly formato = signal<AccountingExportFormat>('csv');
  protected readonly somentePendentes = signal(true);
  protected readonly marcar = signal(false);
  protected readonly gerando = signal(false);
  protected readonly erro = signal<unknown>(null);
  protected readonly resultado = signal<{ arquivo: string; resumo: string } | null>(null);

  protected readonly problema = computed(() => problemaRecorte(this.de(), this.ate()));

  protected exportar(): void {
    if (this.gerando() || this.problema()) return;
    const marcar = this.marcar();

    this.gerando.set(true);
    this.erro.set(null);
    this.resultado.set(null);
    this.api
      .export({
        from: this.de(),
        to: this.ate(),
        format: this.formato(),
        pendingOnly: this.somentePendentes(),
        markExported: marcar,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (arquivo) => {
          this.gerando.set(false);
          salvarArquivo(arquivo.content, arquivo.filename);
          const contagem =
            arquivo.entries === null
              ? 'Contagem não informada pelo servidor.'
              : `${arquivo.entries} lançamento(s), ${arquivo.lines ?? 0} partida(s).`;
          this.resultado.set({
            arquivo: arquivo.filename,
            resumo: marcar ? `${contagem} Marcados como exportados.` : `${contagem} Nada foi marcado.`,
          });
        },
        error: (falha: unknown) => {
          this.gerando.set(false);
          this.erro.set(falha);
        },
      });
  }
}
