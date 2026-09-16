import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { concat, toArray } from 'rxjs';

import { BranchesApiService } from '../core/api/branches-api.service';
import { ConfigurationsApiService } from '../core/api/configurations-api.service';
import { PermissionsService } from '../core/authz/permissions.service';
import { CompanyService } from '../core/company/company.service';
import { formatCnpj } from '../core/lib/format';
import { Alert } from '../ui/alert';
import { ErrorAlert } from '../ui/error-alert';
import { LoadingBlock } from '../ui/loading-block';
import { SelectField } from '../ui/select-field';
import { TextField } from '../ui/text-field';
import { OnboardingStatusService } from './onboarding-status.service';
import {
  CATEGORIAS_SUGERIDAS,
  CENTROS_SUGERIDOS,
  PARAMETROS_SUGERIDOS,
  REGIMES_TRIBUTARIOS,
  parametroRegime,
} from './sugestoes';

interface FormFilial {
  code: string;
  name: string;
  addressCity: string;
  addressState: string;
}

/**
 * Assistente de primeira configuração (RF-006 — UI-079).
 *
 * Uma empresa recém-cadastrada não tem filial, categoria nem centro de custo, e
 * sem isso nenhum título pode ser lançado. O assistente resolve exatamente
 * esses quatro pontos, na ordem em que um dependem do outro, e some do caminho
 * assim que a empresa estiver configurada.
 *
 * Nada aqui é obrigatório e nada é exclusivo: tudo o que o assistente cria é a
 * mesma coisa que as telas de Administração criam, pelos mesmos endpoints e com
 * as mesmas permissões. Quem não puder criar vê o passo como bloqueado, com o
 * motivo — esconder o passo faria parecer que a empresa já está pronta.
 *
 * As criações em lote vão **em série** (`concat`): uma categoria filha depende
 * do código da mãe já existir, e disparar dez POSTs de uma vez deixaria a ordem
 * por conta da rede.
 */
@Component({
  selector: 'sge-onboarding-page',
  imports: [
    FormsModule,
    RouterLink,
    ButtonModule,
    TagModule,
    Alert,
    ErrorAlert,
    LoadingBlock,
    SelectField,
    TextField,
  ],
  template: `
    <p class="crumb">Primeira configuração</p>

    <div class="pagehead">
      <div>
        <h1>Vamos preparar a {{ nomeEmpresa() }}</h1>
        <p>
          Quatro passos para a empresa poder lançar o primeiro título (RF-006). Tudo o que for
          criado aqui continua editável na Administração.
        </p>
      </div>
      <div class="pagehead__actions">
        <p-button label="Ir para o início" severity="secondary" [text]="true" routerLink="/" />
      </div>
    </div>

    @if (erro(); as falha) {
      <div class="espaco"><sge-error-alert [erro]="falha" /></div>
    }

    @if (concluido()) {
      <div class="espaco">
        <sge-alert
          tom="sucesso"
          titulo="Empresa configurada"
          mensagem="Os quatro passos estão prontos. O assistente sai da tela inicial e você pode começar a lançar."
        />
      </div>
    }

    @if (status.carregando() && !situacao()) {
      <section class="card espaco"><sge-loading-block [quantidade]="5" /></section>
    } @else {
      <!-- 1. Empresa -->
      <section class="card secao espaco">
        <div class="passo__cabecalho">
          <h2 class="secao__titulo">1. Dados da empresa</h2>
          <p-tag
            [value]="empresaPronta() ? 'Pronto' : 'Revisar'"
            [severity]="empresaPronta() ? 'success' : 'warn'"
            [rounded]="true"
          />
        </div>
        <p class="passo__texto">
          {{ razaoSocial() }}
          @if (documento()) {
            · {{ documento() }}
          }
        </p>
        <p class="nota">
          Razão social, CNPJ e endereço ficam no cadastro da empresa. É de lá que saem os dados dos
          documentos fiscais.
        </p>
        @if (podeEditarEmpresa()) {
          <p-button
            label="Abrir cadastro da empresa"
            severity="secondary"
            [text]="true"
            routerLink="/administracao/empresas"
          />
        }
      </section>

      <!-- 2. Filial -->
      <section class="card secao">
        <div class="passo__cabecalho">
          <h2 class="secao__titulo">2. Primeira filial</h2>
          <p-tag
            [value]="temFiliais() ? 'Pronto' : 'Pendente'"
            [severity]="temFiliais() ? 'success' : 'warn'"
            [rounded]="true"
          />
        </div>

        @if (temFiliais()) {
          <p class="passo__texto">
            {{ situacao()?.filiais }} filial(is) cadastrada(s). Lançamentos e estoque são separados
            por filial.
          </p>
        } @else if (!permissoes.pode('branches:CREATE')) {
          <p class="passo__texto">Seu perfil não pode criar filiais. Peça a um administrador.</p>
        } @else {
          <p class="nota">
            Toda empresa precisa de pelo menos uma — normalmente a matriz. Os campos que faltarem
            podem ser completados depois.
          </p>
          <div class="grade-campos espaco">
            <sge-text-field
              rotulo="Código"
              [(ngModel)]="filial.code"
              name="codigoFilial"
              dica="Identificador curto, ex.: MAT"
            />
            <sge-text-field rotulo="Nome" [(ngModel)]="filial.name" name="nomeFilial" />
            <sge-text-field rotulo="Cidade" [(ngModel)]="filial.addressCity" name="cidadeFilial" />
            <sge-text-field rotulo="UF" [(ngModel)]="filial.addressState" name="ufFilial" />
          </div>
          <p class="espaco">
            <p-button
              label="Criar filial matriz"
              [loading]="salvando() === 'filial'"
              [disabled]="!filialValida()"
              (onClick)="criarFilial()"
            />
          </p>
        }
      </section>

      <!-- 3. Categorias e centros de custo -->
      <section class="card secao">
        <div class="passo__cabecalho">
          <h2 class="secao__titulo">3. Categorias e centros de custo</h2>
          <p-tag
            [value]="temPlano() ? 'Pronto' : 'Pendente'"
            [severity]="temPlano() ? 'success' : 'warn'"
            [rounded]="true"
          />
        </div>

        <p class="passo__texto">
          Categoria classifica o que entra e o que sai; centro de custo diz de qual área é a
          despesa. Sem as duas, o relatório de resultado nasce vazio.
        </p>

        <ul class="passo__lista">
          <li>
            {{ situacao()?.categorias ?? 0 }} categoria(s) — sugestão cria {{ totalCategorias }}
          </li>
          <li>
            {{ situacao()?.centros ?? 0 }} centro(s) de custo — sugestão cria {{ totalCentros }}
          </li>
        </ul>

        @if (!permissoes.pode('categories:CREATE') && !permissoes.pode('cost-centers:CREATE')) {
          <p class="passo__texto">Seu perfil não pode criar categorias nem centros de custo.</p>
        } @else {
          <p-button
            label="Criar estrutura sugerida"
            [loading]="salvando() === 'plano'"
            [disabled]="temPlano()"
            (onClick)="criarPlano()"
          />
          <p class="nota">
            Receitas e despesas em dois níveis, mais três centros de custo. Tudo editável depois.
          </p>
        }
      </section>

      <!-- 4. Parâmetros -->
      <section class="card secao">
        <div class="passo__cabecalho">
          <h2 class="secao__titulo">4. Parâmetros financeiros e fiscais</h2>
          <p-tag
            [value]="temParametros() ? 'Pronto' : 'Pendente'"
            [severity]="temParametros() ? 'success' : 'warn'"
            [rounded]="true"
          />
        </div>

        @if (!permissoes.pode('settings:UPDATE')) {
          <p class="passo__texto">Seu perfil não pode alterar parâmetros da empresa.</p>
        } @else {
          <div class="grade-campos">
            <sge-select-field
              rotulo="Regime tributário"
              [opcoes]="regimes"
              [(ngModel)]="regime"
              name="regime"
            />
          </div>
          <p class="nota">
            Grava juros de mora (1% ao mês), multa por atraso (2%), tolerância de atraso, moeda e o
            regime escolhido. Valores em decimal, como todo dinheiro no sistema.
          </p>
          <p-button
            label="Gravar parâmetros sugeridos"
            [loading]="salvando() === 'parametros'"
            (onClick)="criarParametros()"
          />
        }
      </section>
    }
  `,
  styles: `
    .passo__cabecalho {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      margin-bottom: 0.4rem;
    }
    .passo__cabecalho .secao__titulo {
      margin: 0;
    }
    .passo__texto {
      margin: 0 0 0.5rem;
      font-size: 0.82rem;
      color: var(--p-text-color);
    }
    .passo__lista {
      margin: 0 0 0.75rem;
      padding-left: 1.1rem;
      font-size: 0.78rem;
      line-height: 1.7;
      color: var(--p-text-muted-color);
    }
  `,
})
export class OnboardingPage {
  protected readonly status = inject(OnboardingStatusService);
  protected readonly permissoes = inject(PermissionsService);
  private readonly empresas = inject(CompanyService);
  private readonly branches = inject(BranchesApiService);
  private readonly config = inject(ConfigurationsApiService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly regimes = REGIMES_TRIBUTARIOS;
  protected readonly totalCategorias = CATEGORIAS_SUGERIDAS.length;
  protected readonly totalCentros = CENTROS_SUGERIDOS.length;

  protected filial: FormFilial = { code: 'MAT', name: 'Matriz', addressCity: '', addressState: '' };
  protected regime = REGIMES_TRIBUTARIOS[0].value;

  protected readonly salvando = signal<'filial' | 'plano' | 'parametros' | null>(null);
  protected readonly erro = signal<unknown>(null);

  protected readonly situacao = this.status.situacao;

  protected readonly nomeEmpresa = computed(() => {
    const ativa = this.empresas.ativa();
    return ativa ? (ativa.company.tradeName ?? ativa.company.legalName) : 'empresa';
  });

  protected readonly razaoSocial = computed(
    () => this.empresas.ativa()?.company.legalName ?? 'Nenhuma empresa ativa',
  );

  protected readonly documento = computed(() => formatCnpj(this.empresas.ativa()?.company.taxId));

  protected readonly empresaPronta = computed(() => {
    const empresa = this.empresas.ativa()?.company;
    return Boolean(empresa?.legalName && empresa.taxId);
  });

  protected readonly temFiliais = computed(() => (this.situacao()?.filiais ?? 0) > 0);
  protected readonly temPlano = computed(
    () => (this.situacao()?.categorias ?? 0) > 0 && (this.situacao()?.centros ?? 0) > 0,
  );
  protected readonly temParametros = computed(() => (this.situacao()?.parametros ?? 0) > 0);

  protected readonly concluido = computed(
    () => this.empresaPronta() && this.temFiliais() && this.temPlano() && this.temParametros(),
  );

  protected readonly podeEditarEmpresa = () => this.permissoes.pode('company:UPDATE');

  constructor() {
    this.status.carregar();
  }

  protected filialValida(): boolean {
    return this.filial.code.trim().length > 0 && this.filial.name.trim().length > 1;
  }

  protected criarFilial(): void {
    if (!this.filialValida() || this.salvando()) return;
    this.salvando.set('filial');
    this.erro.set(null);

    this.branches
      .create({
        code: this.filial.code.trim(),
        name: this.filial.name.trim(),
        addressCity: this.filial.addressCity.trim() || undefined,
        addressState: this.filial.addressState.trim().toUpperCase() || undefined,
        isHeadquarters: true,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.terminou(),
        error: (falha: unknown) => this.falhou(falha),
      });
  }

  protected criarPlano(): void {
    if (this.salvando()) return;
    this.salvando.set('plano');
    this.erro.set(null);

    const criacoes = [
      ...(this.permissoes.pode('categories:CREATE') && (this.situacao()?.categorias ?? 0) === 0
        ? CATEGORIAS_SUGERIDAS.map((categoria) => this.config.createCategory(categoria))
        : []),
      ...(this.permissoes.pode('cost-centers:CREATE') && (this.situacao()?.centros ?? 0) === 0
        ? CENTROS_SUGERIDOS.map((centro) => this.config.createCostCenter(centro))
        : []),
    ];

    if (criacoes.length === 0) {
      this.salvando.set(null);
      return;
    }

    concat(...criacoes)
      .pipe(toArray(), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.terminou(),
        error: (falha: unknown) => this.falhou(falha),
      });
  }

  protected criarParametros(): void {
    if (this.salvando()) return;
    this.salvando.set('parametros');
    this.erro.set(null);

    const parametros = [...PARAMETROS_SUGERIDOS, parametroRegime(this.regime)];

    concat(...parametros.map((parametro) => this.config.upsertSetting(parametro)))
      .pipe(toArray(), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.terminou(),
        error: (falha: unknown) => this.falhou(falha),
      });
  }

  private terminou(): void {
    this.salvando.set(null);
    this.status.invalidar();
  }

  private falhou(falha: unknown): void {
    this.salvando.set(null);
    this.erro.set(falha);
    // A criação em lote pode ter parado no meio: a contagem precisa ser refeita
    // para o passo não continuar dizendo "pendente" sobre o que já foi criado.
    this.status.invalidar();
  }
}
