import { Component, computed, input } from '@angular/core';

import { ErrorAlert } from './error-alert';
import { LoadingBlock } from './loading-block';
import { StateScreen } from './state-screen';

/**
 * Carregando → erro → vazio → conteúdo (UI-081).
 *
 * As telas do sistema repetiam essa escada com variações: umas mostravam o erro
 * e a tabela vazia ao mesmo tempo, outras deixavam o "nenhum registro" piscar
 * durante o carregamento. Aqui a ordem é única e a mensagem de vazio muda
 * sozinha quando há filtro aplicado — porque "nada cadastrado" e "nada com este
 * filtro" levam o usuário a ações diferentes.
 *
 * O conteúdo é projetado e só é desenhado no último degrau.
 */
@Component({
  selector: 'sge-async-state',
  imports: [ErrorAlert, LoadingBlock, StateScreen],
  template: `
    @if (carregando()) {
      <sge-loading-block [quantidade]="linhasEsqueleto()" />
    } @else if (erro()) {
      <sge-error-alert [erro]="erro()" />
    } @else if (vazio()) {
      <sge-state-screen [titulo]="tituloVazio()" [mensagem]="mensagem()" [icone]="icone()" />
    } @else {
      <ng-content />
    }
  `,
})
export class AsyncState {
  readonly carregando = input(false);
  readonly erro = input<unknown>(null);
  readonly vazio = input(false);
  /** `true` quando há busca ou filtro em uso — troca o texto do estado vazio. */
  readonly filtrado = input(false);

  readonly titulo = input('Nenhum registro cadastrado');
  readonly tituloFiltrado = input('Nenhum registro para esses filtros');
  readonly mensagemVazia = input('');
  readonly mensagemFiltrada = input(
    'Revise a busca ou limpe os filtros para ver todos os registros.',
  );
  readonly icone = input('pi-inbox');
  readonly linhasEsqueleto = input(4);

  protected readonly tituloVazio = computed(() =>
    this.filtrado() ? this.tituloFiltrado() : this.titulo(),
  );

  protected readonly mensagem = computed(() =>
    this.filtrado() ? this.mensagemFiltrada() : this.mensagemVazia(),
  );
}
