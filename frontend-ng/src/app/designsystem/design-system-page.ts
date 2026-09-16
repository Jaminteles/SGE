import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';

import { ApiError } from '../core/api/errors';
import { FORMATO_PIPES } from '../core/lib/pipes';
import { UserPreferencesService } from '../core/prefs/user-preferences.service';
import { ThemeService } from '../theme/theme-service';
import { Alert } from '../ui/alert';
import { AsyncState } from '../ui/async-state';
import { ConfirmService } from '../ui/confirm.service';
import { DataTable, type Coluna } from '../ui/data-table';
import { DecimalField } from '../ui/decimal-field';
import { ErrorAlert } from '../ui/error-alert';
import { FilterBar, type ValoresFiltro } from '../ui/filter-bar';
import { LoadingBlock } from '../ui/loading-block';
import { SelectField } from '../ui/select-field';
import { StateScreen } from '../ui/state-screen';
import { TextField } from '../ui/text-field';

const ESPACOS = ['1', '2', '3', '4', '5', '6'];
const FONTES = ['xs', 'sm', 'md', 'lg', 'xl'];
const CORES = [
  { token: '--p-primary-color', nome: 'Primária', uso: 'Ação principal, foco, seleção' },
  { token: '--p-content-background', nome: 'Fundo de cartão', uso: 'Cartões, tabelas, diálogos' },
  { token: '--p-content-border-color', nome: 'Borda', uso: 'Separação entre blocos' },
  { token: '--p-text-color', nome: 'Texto', uso: 'Conteúdo' },
  { token: '--p-text-muted-color', nome: 'Texto secundário', uso: 'Rótulo, dica, metadado' },
  { token: '--p-green-500', nome: 'Verde', uso: 'Entrada de dinheiro, sucesso' },
  { token: '--p-amber-500', nome: 'Âmbar', uso: 'Vencendo, atenção' },
  { token: '--p-red-500', nome: 'Vermelho', uso: 'Saída de dinheiro, erro, atraso' },
];

interface LinhaExemplo {
  codigo: string;
  descricao: string;
  valor: string;
}

/**
 * Documentação viva do design system (UI-076).
 *
 * "Viva" porque não é imagem nem texto sobre os componentes: é a aplicação
 * desenhando os próprios componentes, com os mesmos tokens. Quando o preset
 * muda, esta tela muda junto — e a divergência entre o que está documentado e o
 * que está em produção deixa de ser possível.
 *
 * Serve a duas perguntas do dia a dia: "que degrau de espaço eu uso aqui?" e
 * "esse estado já existe pronto?". A resposta errada para a segunda é o que
 * fabrica a décima variação de tela vazia.
 */
@Component({
  selector: 'sge-design-system-page',
  imports: [
    FormsModule,
    ButtonModule,
    TagModule,
    Alert,
    AsyncState,
    DataTable,
    DecimalField,
    ErrorAlert,
    FilterBar,
    LoadingBlock,
    SelectField,
    StateScreen,
    TextField,
    ...FORMATO_PIPES,
  ],
  template: `
    <p class="crumb">Design system</p>

    <div class="pagehead">
      <div>
        <h1>Design system</h1>
        <p>
          Os tokens e os componentes desta interface, desenhados pela própria aplicação (UI-076).
        </p>
      </div>
      <div class="pagehead__actions">
        <p-button
          [label]="tema.escuro() ? 'Ver no tema claro' : 'Ver no tema escuro'"
          severity="secondary"
          [outlined]="true"
          (onClick)="tema.alternar()"
        />
      </div>
    </div>

    <section class="card secao">
      <h2 class="secao__titulo">Cor</h2>
      <p class="ds__texto">
        Toda a cor sai do preset em <code>theme/sge-preset.ts</code> e resolve claro/escuro pela
        função CSS <code>light-dark()</code>. Verde e vermelho têm significado financeiro — entrada
        e saída — e por isso a primária do produto é violeta: uma ação em destaque não pode parecer
        um lançamento a receber.
      </p>
      <div class="ds__cores">
        @for (cor of cores; track cor.token) {
          <div class="ds__cor">
            <span class="ds__amostra" [style.background]="'var(' + cor.token + ')'"></span>
            <div>
              <strong>{{ cor.nome }}</strong>
              <code>{{ cor.token }}</code>
              <span class="ds__uso">{{ cor.uso }}</span>
            </div>
          </div>
        }
      </div>
    </section>

    <section class="card secao">
      <h2 class="secao__titulo">Espaço e raio</h2>
      <p class="ds__texto">
        Seis degraus de espaço; o que estiver fora deles é sinal de que a tela está pedindo um
        componente novo, não um valor novo.
      </p>
      @for (espaco of espacos; track espaco) {
        <div class="ds__linha">
          <code>--sge-espaco-{{ espaco }}</code>
          <span class="ds__barra" [style.width]="'var(--sge-espaco-' + espaco + ')'"></span>
        </div>
      }
      <div class="ds__linha ds__linha--raio">
        <code>--sge-raio-1</code>
        <span class="ds__caixa" style="border-radius: var(--sge-raio-1)"></span>
        <code>--sge-raio-2</code>
        <span class="ds__caixa" style="border-radius: var(--sge-raio-2)"></span>
      </div>
    </section>

    <section class="card secao">
      <h2 class="secao__titulo">Tipografia</h2>
      @for (fonte of fontes; track fonte) {
        <p class="ds__amostra-texto" [style.font-size]="'var(--sge-fonte-' + fonte + ')'">
          <code>--sge-fonte-{{ fonte }}</code> — Títulos a pagar vencendo nos próximos sete dias
        </p>
      }
      <p class="nota">
        Número de dinheiro usa <code>font-variant-numeric: tabular-nums</code> e alinha à direita:
        em coluna, os valores ficam comparáveis a olho.
      </p>
    </section>

    <section class="card secao">
      <h2 class="secao__titulo">Formatos pt-BR (UI-084)</h2>
      <p class="ds__texto">
        Dinheiro sai do banco como <code>numeric(18,2)</code> e chega aqui como
        <strong>string</strong>. Estes pipes formatam a string canônica direto; passar pelos pipes
        nativos do Angular obrigaria a converter para <code>number</code>, e a partir daí o que está
        na tela deixaria de ser garantidamente o que está no banco (RN-012).
      </p>
      <table class="ds__formatos">
        <tbody>
          <tr>
            <th scope="row"><code>| sgeMoeda</code></th>
            <td>
              <code>'{{ exemploValor }}'</code>
            </td>
            <td>{{ exemploValor | sgeMoeda }}</td>
          </tr>
          <tr>
            <th scope="row"><code>| sgeDecimal: 6</code></th>
            <td>
              <code>'{{ exemploQuantidade }}'</code>
            </td>
            <td>{{ exemploQuantidade | sgeDecimal: 6 }}</td>
          </tr>
          <tr>
            <th scope="row"><code>| sgeInteiro</code></th>
            <td>
              <code>{{ exemploContagem }}</code>
            </td>
            <td>{{ exemploContagem | sgeInteiro }}</td>
          </tr>
          <tr>
            <th scope="row"><code>| sgePercentual</code></th>
            <td>
              <code>'{{ exemploAliquota }}'</code>
            </td>
            <td>{{ exemploAliquota | sgePercentual }}</td>
          </tr>
          <tr>
            <th scope="row"><code>| sgeData</code></th>
            <td>
              <code>'{{ exemploData }}'</code>
            </td>
            <td>{{ exemploData | sgeData }}</td>
          </tr>
          <tr>
            <th scope="row"><code>| sgeDataHora</code></th>
            <td>
              <code>'{{ exemploDataHora }}'</code>
            </td>
            <td>{{ exemploDataHora | sgeDataHora }}</td>
          </tr>
          <tr>
            <th scope="row"><code>| sgeCnpj</code></th>
            <td>
              <code>'{{ exemploCnpj }}'</code>
            </td>
            <td>{{ exemploCnpj | sgeCnpj }}</td>
          </tr>
        </tbody>
      </table>
      <p class="nota">
        Data é lida dos dígitos da própria string: <code>new Date('2026-08-10')</code> é meia-noite
        UTC e voltaria como 09/08 no fuso de Brasília — vencimento não pode andar um dia para trás.
      </p>
    </section>

    <section class="card secao">
      <h2 class="secao__titulo">Campos</h2>
      <div class="grade-campos">
        <sge-text-field
          rotulo="Razão social"
          dica="Como consta no CNPJ"
          [(ngModel)]="texto"
          name="ds-texto"
        />
        <sge-text-field
          rotulo="Campo com erro"
          erro="Informe a razão social."
          [(ngModel)]="textoInvalido"
          name="ds-texto-erro"
        />
        <sge-select-field
          rotulo="Carteira"
          [opcoes]="opcoes"
          [(ngModel)]="opcao"
          name="ds-select"
        />
        <sge-decimal-field rotulo="Valor" [(ngModel)]="valor" name="ds-decimal" />
      </div>
      <p class="nota">
        Dinheiro entra e sai como <code>string</code> decimal — nunca <code>number</code> (RN-012).
      </p>
    </section>

    <section class="card secao">
      <h2 class="secao__titulo">Avisos</h2>
      <div class="ds__pilha">
        <sge-alert
          tom="erro"
          titulo="Não foi possível salvar"
          mensagem="Revise os campos em destaque."
        />
        <sge-alert tom="aviso" titulo="Três títulos vencem hoje" />
        <sge-alert tom="info" titulo="A conciliação roda às 3h" />
        <sge-alert tom="sucesso" titulo="Parceiro inativado." />
        <sge-error-alert [erro]="erroExemplo" />
      </div>
      <p class="nota">
        Só o tom "erro" usa <code>role="alert"</code>, que interrompe o leitor de tela. Sucesso não
        corta a leitura de ninguém.
      </p>
    </section>

    <section class="card secao">
      <h2 class="secao__titulo">Estados (UI-081)</h2>
      <p class="ds__texto">
        Carregando → erro → vazio → conteúdo, nesta ordem, pelo
        <code>&lt;sge-async-state&gt;</code>. O texto do vazio muda quando há filtro aplicado.
      </p>
      <div class="ds__pilha">
        <div class="card"><sge-loading-block [quantidade]="3" /></div>
        <div class="card">
          <sge-async-state
            [vazio]="true"
            titulo="Nenhum parceiro cadastrado"
            mensagemVazia="Cadastre o primeiro para começar a lançar títulos."
          >
            <p>conteúdo</p>
          </sge-async-state>
        </div>
        <div class="card">
          <sge-state-screen
            titulo="Sem permissão no perfil"
            mensagem="Peça acesso a um administrador da empresa."
            icone="pi-lock"
          />
        </div>
      </div>
      <p class="espaco">
        <p-button
          label="Ver confirmação de ação"
          severity="secondary"
          (onClick)="confirmarExemplo()"
        />
        @if (respostaConfirmacao(); as resposta) {
          <span class="ds__uso">{{ resposta }}</span>
        }
      </p>
    </section>

    <section class="card secao">
      <h2 class="secao__titulo">Listagem</h2>
      <p class="ds__texto">
        Busca, filtros, paginação e ordenação são <strong>sempre</strong> server-side: a coleção
        inteira de um ERP não cabe no navegador, e filtrar no cliente esconderia registros que o
        usuário acha que não existem.
      </p>
      <sge-filter-bar [valores]="filtros()" (mudou)="filtros.set($event)" />
      <div class="card table-card espaco">
        <sge-data-table [colunas]="colunas" [linhas]="linhas" [total]="linhas.length" />
      </div>
      <p class="nota">
        Com <code>chave</code> preenchida, a tabela ganha o seletor de colunas e a barra ganha os
        filtros salvos, guardados nas preferências do usuário (UI-078).
      </p>
    </section>

    <section class="card secao">
      <h2 class="secao__titulo">Densidade e impressão</h2>
      <p class="ds__texto">
        Densidade é uma classe no <code>&lt;html&gt;</code>, como o tema. Impressão também não tem
        tela própria: o <code>&#64;media print</code> global tira a moldura e imprime o conteúdo.
      </p>
      <p-button
        [label]="prefs.compacta() ? 'Voltar ao confortável' : 'Ver em densidade compacta'"
        severity="secondary"
        [outlined]="true"
        (onClick)="alternarDensidade()"
      />
    </section>
  `,
  styles: `
    .ds__formatos {
      width: 100%;
      border-collapse: collapse;
      font-size: var(--sge-fonte-sm);
    }
    .ds__formatos th,
    .ds__formatos td {
      padding: 0.35rem 0.6rem 0.35rem 0;
      text-align: left;
      font-weight: 400;
      vertical-align: baseline;
    }
    .ds__formatos td:last-child {
      font-variant-numeric: tabular-nums;
      color: var(--p-text-color);
    }
    .ds__texto {
      margin: 0 0 0.875rem;
      font-size: var(--sge-fonte-md);
      line-height: 1.55;
      color: var(--p-text-color);
    }
    .ds__pilha {
      display: flex;
      flex-direction: column;
      gap: var(--sge-espaco-3);
    }
    .ds__cores {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: var(--sge-espaco-4);
    }
    .ds__cor {
      display: flex;
      align-items: center;
      gap: var(--sge-espaco-3);
    }
    .ds__cor div {
      display: flex;
      flex-direction: column;
    }
    .ds__amostra {
      width: 2.25rem;
      height: 2.25rem;
      border-radius: var(--sge-raio-1);
      border: 1px solid var(--p-content-border-color);
    }
    .ds__uso {
      font-size: var(--sge-fonte-xs);
      color: var(--p-text-muted-color);
    }
    .ds__linha {
      display: flex;
      align-items: center;
      gap: var(--sge-espaco-3);
      margin-bottom: var(--sge-espaco-2);
    }
    .ds__linha--raio {
      margin-top: var(--sge-espaco-4);
    }
    .ds__barra {
      height: 0.75rem;
      background: var(--p-primary-color);
      border-radius: 2px;
    }
    .ds__caixa {
      width: 2.5rem;
      height: 1.75rem;
      background: color-mix(in srgb, var(--p-primary-color) 25%, transparent);
      border: 1px solid var(--p-primary-color);
    }
    .ds__amostra-texto {
      margin: 0 0 var(--sge-espaco-2);
      color: var(--p-text-color);
    }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: var(--sge-fonte-xs);
      color: var(--p-text-muted-color);
    }
  `,
})
export class DesignSystemPage {
  /** Valores de amostra da seção de formatos — sempre no canônico da API. */
  protected readonly exemploValor = '1234567.5';
  protected readonly exemploQuantidade = '10.123456';
  protected readonly exemploContagem = 1234567;
  protected readonly exemploAliquota = '18.500000';
  protected readonly exemploData = '2026-08-10';
  protected readonly exemploDataHora = '2026-08-10T14:35:00';
  protected readonly exemploCnpj = '12345678000190';

  protected readonly tema = inject(ThemeService);
  protected readonly prefs = inject(UserPreferencesService);
  private readonly confirmacao = inject(ConfirmService);

  protected readonly cores = CORES;
  protected readonly espacos = ESPACOS;
  protected readonly fontes = FONTES;

  protected readonly opcoes = [
    { value: 'PAGAR', label: 'A pagar' },
    { value: 'RECEBER', label: 'A receber' },
  ];

  protected texto = 'Acme Indústria LTDA';
  protected textoInvalido = '';
  protected opcao = 'PAGAR';
  protected valor = '1234.56';

  protected readonly erroExemplo = new ApiError(422, 'Revise os campos informados.', {
    details: ['Informe o CNPJ.', 'A data de vencimento é obrigatória.'],
  });

  protected readonly filtros = signal<ValoresFiltro>({ q: '' });
  protected readonly respostaConfirmacao = signal<string | null>(null);

  protected readonly colunas: Coluna[] = [
    { campo: 'codigo', cabecalho: 'Código', largura: '9rem' },
    { campo: 'descricao', cabecalho: 'Descrição' },
    { campo: 'valor', cabecalho: 'Valor', numerica: true, largura: '10rem' },
  ];

  protected readonly linhas: LinhaExemplo[] = [
    { codigo: '2.1', descricao: 'Fornecedores e mercadorias', valor: '18.400,00' },
    { codigo: '2.2', descricao: 'Folha de pagamento e encargos', valor: '52.310,55' },
    { codigo: '2.3', descricao: 'Impostos e taxas', valor: '9.128,30' },
  ];

  protected async confirmarExemplo(): Promise<void> {
    const confirmado = await this.confirmacao.confirmar({
      titulo: 'Inativar parceiro?',
      mensagem:
        'O parceiro deixa de aparecer nas listagens e não pode ser usado em novos lançamentos. O histórico é preservado.',
      rotuloConfirmar: 'Inativar',
      destrutivo: true,
    });
    this.respostaConfirmacao.set(confirmado ? 'Confirmado.' : 'Cancelado.');
  }

  protected alternarDensidade(): void {
    this.prefs.definirDensidade(this.prefs.compacta() ? 'confortavel' : 'compacta');
  }
}
