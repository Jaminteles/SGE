import { Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TableModule } from 'primeng/table';

import { CompanyService } from '../core/company/company.service';
import { UserPreferencesService, type Densidade } from '../core/prefs/user-preferences.service';
import type { Tema } from '../theme/theme-service';
import { ConfirmService } from '../ui/confirm.service';
import { StateScreen } from '../ui/state-screen';
import { rotuloTela } from './rotulos';

/**
 * Preferências do usuário (UI-078).
 *
 * Tema, densidade, colunas escondidas e filtros salvos, no mesmo lugar. Tudo
 * vale só para quem está logado, nesta máquina: são escolhas de interface, não
 * dados da empresa — nenhuma delas atravessa a API nem muda o que o usuário
 * pode ver, que continua sendo decisão do backend.
 */
@Component({
  selector: 'sge-preferences-page',
  imports: [FormsModule, RouterLink, ButtonModule, SelectButtonModule, TableModule, StateScreen],
  template: `
    <p class="crumb">Preferências</p>

    <div class="pagehead">
      <div>
        <h1>Preferências</h1>
        <p>Aparência, densidade e recortes salvos — valem para o seu usuário neste navegador.</p>
      </div>
    </div>

    <section class="card secao">
      <h2 class="secao__titulo">Aparência</h2>
      <div class="grade-campos">
        <div class="campo">
          <span class="campo__rotulo">Tema</span>
          <p-selectbutton
            [options]="temas"
            optionLabel="label"
            optionValue="value"
            [allowEmpty]="false"
            [ngModel]="prefs.temaAtual()"
            (ngModelChange)="mudarTema($event)"
            ariaLabelledBy="tema"
          />
          <p class="campo__dica">
            O tema escuro é o padrão do produto. Veja os dois lado a lado no
            <a routerLink="/design-system">design system</a>.
          </p>
        </div>

        <div class="campo">
          <span class="campo__rotulo">Densidade</span>
          <p-selectbutton
            [options]="densidades"
            optionLabel="label"
            optionValue="value"
            [allowEmpty]="false"
            [ngModel]="prefs.densidade()"
            (ngModelChange)="mudarDensidade($event)"
          />
          <p class="campo__dica">
            Compacta encolhe o respiro das listagens: mais linhas por tela, mesma informação.
          </p>
        </div>
      </div>
    </section>

    <section class="card secao">
      <h2 class="secao__titulo">Colunas escondidas</h2>
      @if (colunas().length === 0) {
        <p class="nota">
          Nenhuma coluna escondida. O seletor de colunas fica no canto superior direito de cada
          listagem.
        </p>
      } @else {
        <p-table [value]="colunas()" [tableStyle]="{ 'min-width': '100%' }">
          <ng-template #header>
            <tr>
              <th scope="col">Tela</th>
              <th scope="col">Colunas escondidas</th>
            </tr>
          </ng-template>
          <ng-template #body let-item>
            <tr>
              <td>{{ item.tela }}</td>
              <td>{{ item.campos }}</td>
            </tr>
          </ng-template>
        </p-table>
        <p class="nota">
          <p-button
            label="Mostrar todas as colunas"
            severity="secondary"
            [text]="true"
            (onClick)="restaurarColunas()"
          />
        </p>
      }
    </section>

    <section class="card secao">
      <h2 class="secao__titulo">Filtros salvos</h2>
      @if (filtros().length === 0) {
        <sge-state-screen
          titulo="Nenhum filtro salvo"
          mensagem="Monte um recorte na barra de filtros de qualquer listagem e use “Salvar filtro”."
          icone="pi-bookmark"
        />
      } @else {
        <p-table [value]="filtros()" [tableStyle]="{ 'min-width': '100%' }">
          <ng-template #header>
            <tr>
              <th scope="col">Nome</th>
              <th scope="col">Tela</th>
              <th scope="col">Empresa</th>
              <th scope="col"></th>
            </tr>
          </ng-template>
          <ng-template #body let-filtro>
            <tr>
              <td>{{ filtro.nome }}</td>
              <td>{{ filtro.tela }}</td>
              <td>{{ filtro.empresa }}</td>
              <td class="acoes">
                <p-button
                  label="Excluir"
                  severity="secondary"
                  [text]="true"
                  size="small"
                  (onClick)="excluir(filtro.id, filtro.nome)"
                />
              </td>
            </tr>
          </ng-template>
        </p-table>
      }
    </section>
  `,
})
export class PreferencesPage {
  protected readonly prefs = inject(UserPreferencesService);
  private readonly empresas = inject(CompanyService);
  private readonly confirmacao = inject(ConfirmService);

  protected readonly temas: { label: string; value: Tema }[] = [
    { label: 'Escuro', value: 'dark' },
    { label: 'Claro', value: 'light' },
  ];

  protected readonly densidades: { label: string; value: Densidade }[] = [
    { label: 'Confortável', value: 'confortavel' },
    { label: 'Compacta', value: 'compacta' },
  ];

  protected readonly colunas = computed(() =>
    Object.entries(this.prefs.prefs().colunasOcultas).map(([chave, campos]) => ({
      tela: rotuloTela(chave),
      campos: campos.join(', '),
    })),
  );

  /** Todos os recortes, inclusive os de outras empresas — é aqui que se limpa. */
  protected readonly filtros = computed(() =>
    this.prefs.todosOsFiltros().map((filtro) => ({
      id: filtro.id,
      nome: filtro.nome,
      tela: rotuloTela(filtro.chave),
      empresa: this.nomeEmpresa(filtro.empresaId),
    })),
  );

  protected mudarTema(tema: Tema): void {
    this.prefs.definirTema(tema);
  }

  protected mudarDensidade(densidade: Densidade): void {
    this.prefs.definirDensidade(densidade);
  }

  protected async restaurarColunas(): Promise<void> {
    const confirmado = await this.confirmacao.confirmar({
      titulo: 'Mostrar todas as colunas?',
      mensagem: 'As listagens voltam a exibir todas as colunas em todas as telas.',
      rotuloConfirmar: 'Mostrar todas',
    });
    if (confirmado) this.prefs.restaurarColunas();
  }

  protected async excluir(id: string, nome: string): Promise<void> {
    const confirmado = await this.confirmacao.confirmar({
      titulo: 'Excluir filtro salvo?',
      mensagem: `O recorte "${nome}" sai da lista. Os registros não são afetados.`,
      rotuloConfirmar: 'Excluir',
      destrutivo: true,
    });
    if (confirmado) this.prefs.removerFiltro(id);
  }

  private nomeEmpresa(empresaId: string | null): string {
    if (!empresaId) return '—';
    const vinculo = this.empresas.empresas().find((m) => m.companyId === empresaId);
    if (!vinculo) return 'Outra empresa';
    return vinculo.company.tradeName ?? vinculo.company.legalName;
  }
}
