import type {
  AppNotification,
  AutomationAction,
  AutomationConditions,
  AutomationRule,
  AutomationRuleInput,
  AutomationRuleUpdate,
  AutomationTrigger,
  NotificationChannel,
  NotificationStatus,
} from '../core/api/types';
import type { OpcaoFiltro } from '../ui/filter-bar';

/** Severidades aceitas pela `p-tag` do PrimeNG. */
export type Severidade = 'success' | 'warn' | 'danger' | 'info' | 'secondary';

function opcoes<T extends string>(rotulos: Record<T, string>): OpcaoFiltro[] {
  return (Object.keys(rotulos) as T[]).map((valor) => ({ value: valor, label: rotulos[valor] }));
}

// ---------------------------------------------------------------------------
// Caixa de entrada (RF-119)
// ---------------------------------------------------------------------------

/** `notificacao.tipo` — o que aconteceu, do ponto de vista de quem lê. */
export const ROTULO_TIPO_AVISO: Record<string, string> = {
  VENCIMENTO: 'Vencimento',
  PAGAMENTO_PROCESSADO: 'Pagamento processado',
  PAGAMENTO_FALHOU: 'Pagamento falhou',
  APROVACAO_PENDENTE: 'Aprovação pendente',
  DIVERGENCIA: 'Divergência',
};

export const OPCOES_TIPO_AVISO = opcoes(ROTULO_TIPO_AVISO);

export const ROTULO_STATUS_AVISO: Record<NotificationStatus, string> = {
  PENDENTE: 'Na fila',
  ENVIADA: 'Entregue',
  LIDA: 'Lida',
  FALHA: 'Falha na entrega',
  CANCELADA: 'Cancelada',
};

export const OPCOES_STATUS_AVISO = opcoes(ROTULO_STATUS_AVISO);

export const ROTULO_CANAL: Record<NotificationChannel, string> = {
  INTERNO: 'Aviso interno',
  EMAIL: 'E-mail',
};

export const OPCOES_CANAL = opcoes(ROTULO_CANAL);

/**
 * Prioridade de 1 a 5, como o backend a grava.
 *
 * O número sozinho não diz nada a quem lê a caixa de entrada — "1" só é urgente
 * para quem conhece a escala. O rótulo é o que aparece na tela; o número fica
 * no `title` para quem precisa conferir contra a regra que o gerou.
 */
export const ROTULO_PRIORIDADE: Record<number, string> = {
  1: 'Urgente',
  2: 'Alta',
  3: 'Normal',
  4: 'Baixa',
  5: 'Informativo',
};

const SEVERIDADE_PRIORIDADE: Record<number, Severidade> = {
  1: 'danger',
  2: 'warn',
  3: 'info',
  4: 'secondary',
  5: 'secondary',
};

export function rotuloPrioridade(prioridade: number): string {
  return ROTULO_PRIORIDADE[prioridade] ?? `Prioridade ${prioridade}`;
}

export function severidadePrioridade(prioridade: number): Severidade {
  return SEVERIDADE_PRIORIDADE[prioridade] ?? 'info';
}

export function naoLida(aviso: AppNotification): boolean {
  return aviso.readAt === null && aviso.status !== 'CANCELADA';
}

/**
 * Destino do aviso dentro da aplicação (RF-119).
 *
 * O backend grava `link` como caminho relativo da própria aplicação. Link
 * absoluto vindo do servidor não é navegado: um caminho que sai do domínio
 * transformaria a caixa de entrada em vetor de redirecionamento.
 */
export function destinoInterno(aviso: AppNotification): string | null {
  const link = aviso.link;
  if (!link) return null;
  if (!link.startsWith('/') || link.startsWith('//')) return null;
  return link;
}

// ---------------------------------------------------------------------------
// Gatilhos e regras (RF-120 a RF-125)
// ---------------------------------------------------------------------------

export const ROTULO_GATILHO: Record<AutomationTrigger, string> = {
  TITULO_VENCENDO: 'Título vencendo',
  PAGAMENTO_PROCESSADO: 'Pagamento processado',
  PAGAMENTO_FALHOU: 'Pagamento falhou',
  APROVACAO_PENDENTE: 'Aprovação pendente',
  DIVERGENCIA_CONCILIACAO: 'Divergência na conciliação',
};

export const OPCOES_GATILHO = opcoes(ROTULO_GATILHO);

/** O que a varredura observa em cada gatilho, em uma linha. */
export const DESCRICAO_GATILHO: Record<AutomationTrigger, string> = {
  TITULO_VENCENDO: 'Títulos a vencer no horizonte configurado, e os já vencidos (RF-121).',
  PAGAMENTO_PROCESSADO: 'Pagamentos que o banco confirmou (RF-122).',
  PAGAMENTO_FALHOU: 'Pagamentos recusados ou devolvidos pelo banco (RF-122).',
  APROVACAO_PENDENTE: 'Aprovações paradas esperando decisão (RF-123).',
  DIVERGENCIA_CONCILIACAO: 'Movimentos bancários que não fecham com o sistema (RF-124).',
};

/** Horizonte padrão do alerta de vencimento (`DEFAULT_DUE_DAYS_AHEAD`). */
export const DIAS_PADRAO_VENCIMENTO = 3;

/** Só `TITULO_VENCENDO` usa condição de valor, horizonte e sentido do título. */
export function aceitaCondicoes(gatilho: AutomationTrigger): boolean {
  return gatilho === 'TITULO_VENCENDO';
}

export interface FormAcao {
  channel: NotificationChannel;
  permission: string;
  priority: string;
}

export interface FormRegraAutomacao {
  id: string | null;
  name: string;
  description: string;
  triggerEvent: AutomationTrigger;
  daysAhead: string;
  minAmount: string;
  entryType: '' | 'PAGAR' | 'RECEBER';
  includeOverdue: boolean;
  isActive: boolean;
  acoes: FormAcao[];
}

export function acaoVazia(): FormAcao {
  return { channel: 'INTERNO', permission: '', priority: '3' };
}

export function formRegraVazia(): FormRegraAutomacao {
  return {
    id: null,
    name: '',
    description: '',
    triggerEvent: 'TITULO_VENCENDO',
    daysAhead: String(DIAS_PADRAO_VENCIMENTO),
    minAmount: '',
    entryType: '',
    includeOverdue: true,
    isActive: true,
    acoes: [acaoVazia()],
  };
}

export function formRegraDe(regra: AutomationRule): FormRegraAutomacao {
  const condicoes = regra.conditions ?? {};
  return {
    id: regra.id,
    name: regra.name,
    description: regra.description ?? '',
    triggerEvent: regra.triggerEvent,
    daysAhead: condicoes.daysAhead === undefined ? '' : String(condicoes.daysAhead),
    minAmount: condicoes.minAmount ?? '',
    entryType: condicoes.entryType ?? '',
    includeOverdue: condicoes.includeOverdue ?? true,
    isActive: regra.isActive,
    acoes: regra.actions.map((acao) => ({
      channel: acao.channel,
      permission: acao.permission ?? '',
      priority: String(acao.priority ?? 3),
    })),
  };
}

const PADRAO_PERMISSAO = /^[a-z0-9-]+:(CREATE|READ|UPDATE|DELETE|APPROVE|EXPORT)$/;
const PADRAO_VALOR = /^\d{1,16}(\.\d{1,2})?$/;

/**
 * O que o backend recusa e a tela recusa antes (RF-125).
 *
 * A ação precisa de destinatário: uma regra que dispara e não endereça ninguém
 * grava avisos que ninguém vê — pior do que não avisar, porque parece que
 * avisou. Como esta tela endereça por permissão (o endereçamento que acompanha
 * o RBAC: quem pode aprovar é quem precisa saber), a permissão é obrigatória
 * aqui, ainda que a API também aceite lista de usuários.
 */
export function problemaRegra(form: FormRegraAutomacao): string | null {
  if (form.name.trim().length < 2) return 'Dê um nome à regra.';
  if (form.acoes.length === 0) return 'Uma regra sem ação não avisa ninguém.';

  for (const acao of form.acoes) {
    const permissao = acao.permission.trim();
    if (!permissao) return 'Informe quem recebe o aviso: a permissão do destinatário.';
    if (!PADRAO_PERMISSAO.test(permissao)) {
      return `Permissão inválida: use o formato recurso:AÇÃO, como financial-entries:READ.`;
    }
    const prioridade = Number(acao.priority);
    if (!Number.isInteger(prioridade) || prioridade < 1 || prioridade > 5) {
      return 'A prioridade do aviso vai de 1 (urgente) a 5 (informativo).';
    }
  }

  if (aceitaCondicoes(form.triggerEvent)) {
    if (form.daysAhead !== '') {
      const dias = Number(form.daysAhead);
      if (!Number.isInteger(dias) || dias < 0 || dias > 90) {
        return 'O horizonte do alerta vai de 0 a 90 dias.';
      }
    }
    if (form.minAmount !== '' && !PADRAO_VALOR.test(form.minAmount.trim())) {
      return 'O valor mínimo deve ter até 2 casas decimais.';
    }
  }
  return null;
}

function condicoesDe(form: FormRegraAutomacao): AutomationConditions | undefined {
  if (!aceitaCondicoes(form.triggerEvent)) return undefined;
  const condicoes: AutomationConditions = { includeOverdue: form.includeOverdue };
  if (form.daysAhead !== '') condicoes.daysAhead = Number(form.daysAhead);
  if (form.minAmount.trim() !== '') condicoes.minAmount = form.minAmount.trim();
  if (form.entryType !== '') condicoes.entryType = form.entryType;
  return condicoes;
}

function acoesDe(form: FormRegraAutomacao): AutomationAction[] {
  return form.acoes.map((acao) => ({
    type: 'NOTIFICAR' as const,
    channel: acao.channel,
    permission: acao.permission.trim(),
    priority: Number(acao.priority),
  }));
}

export function montarRegra(form: FormRegraAutomacao): AutomationRuleInput {
  const condicoes = condicoesDe(form);
  return {
    name: form.name.trim(),
    triggerEvent: form.triggerEvent,
    actions: acoesDe(form),
    isActive: form.isActive,
    ...(form.description.trim() ? { description: form.description.trim() } : {}),
    ...(condicoes ? { conditions: condicoes } : {}),
  };
}

/**
 * Comparação estável: a ordem das chaves do `jsonb` que volta do banco não é a
 * ordem em que o formulário as monta, e comparar o texto cru marcaria como
 * alterada uma condição idêntica.
 */
function mesmoConteudo(a: unknown, b: unknown): boolean {
  const normalizar = (valor: unknown): unknown => {
    if (Array.isArray(valor)) return valor.map(normalizar);
    if (valor && typeof valor === 'object') {
      return Object.fromEntries(
        Object.entries(valor as Record<string, unknown>)
          .filter(([, item]) => item !== undefined)
          .sort(([x], [y]) => x.localeCompare(y))
          .map(([chave, item]) => [chave, normalizar(item)]),
      );
    }
    return valor;
  };
  return JSON.stringify(normalizar(a)) === JSON.stringify(normalizar(b));
}

/**
 * A alteração manda o conjunto inteiro de ações e condições, nunca um pedaço.
 *
 * Ação e condição são listas fechadas que o motor lê de uma vez: mandar metade
 * deixaria a regra decidindo por um conjunto que ninguém escreveu.
 */
export function montarEdicaoRegra(
  form: FormRegraAutomacao,
  atual: AutomationRule,
): AutomationRuleUpdate {
  const corpo: AutomationRuleUpdate = {};
  const nome = form.name.trim();
  if (nome !== atual.name) corpo.name = nome;

  const descricao = form.description.trim();
  if (descricao !== (atual.description ?? '')) corpo.description = descricao;

  if (form.triggerEvent !== atual.triggerEvent) corpo.triggerEvent = form.triggerEvent;
  if (form.isActive !== atual.isActive) corpo.isActive = form.isActive;

  const acoes = acoesDe(form);
  if (!mesmoConteudo(acoes, atual.actions)) corpo.actions = acoes;

  const condicoes = condicoesDe(form);
  if (!mesmoConteudo(condicoes ?? null, atual.conditions ?? null)) corpo.conditions = condicoes;
  return corpo;
}

/** Resumo das condições de uma regra, para a lista e para os cartões. */
export function resumoCondicoes(regra: AutomationRule): string {
  const condicoes = regra.conditions;
  if (!condicoes || !aceitaCondicoes(regra.triggerEvent)) return 'Todo fato observado';

  const partes: string[] = [];
  const dias = condicoes.daysAhead ?? DIAS_PADRAO_VENCIMENTO;
  partes.push(`${dias} dia(s) de antecedência`);
  if (condicoes.minAmount) partes.push(`a partir de R$ ${condicoes.minAmount}`);
  if (condicoes.entryType) partes.push(`só a ${condicoes.entryType.toLowerCase()}`);
  if (condicoes.includeOverdue === false) partes.push('sem os já vencidos');
  return partes.join(' · ');
}

/** Resumo dos destinatários, para a lista. */
export function resumoAcoes(regra: AutomationRule): string {
  return regra.actions
    .map((acao) => {
      const destino = acao.permission ?? `${acao.userIds?.length ?? 0} usuário(s)`;
      return `${ROTULO_CANAL[acao.channel]} → ${destino}`;
    })
    .join(' · ');
}

/** Situação da execução registrada — `JobStatus`, o mesmo vocabulário da fila. */
export const ROTULO_EXECUCAO: Record<string, string> = {
  PENDENTE: 'Na fila',
  PROCESSANDO: 'Em execução',
  CONCLUIDO: 'Concluída',
  FALHA: 'Falhou',
  CANCELADO: 'Cancelada',
  AGENDADO: 'Agendada',
};

export function rotuloExecucao(status: string): string {
  return ROTULO_EXECUCAO[status] ?? status;
}

export function severidadeExecucao(status: string): Severidade {
  if (status === 'CONCLUIDO') return 'success';
  if (status === 'FALHA') return 'danger';
  if (status === 'CANCELADO') return 'secondary';
  return 'info';
}
