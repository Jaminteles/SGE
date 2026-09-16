import type {
  Integration,
  IntegrationEnvironment,
  IntegrationEventSeverity,
  IntegrationInput,
  IntegrationStatus,
  IntegrationUpdate,
} from '../core/api/types';
import type { OpcaoFiltro } from '../ui/filter-bar';

/** Severidades aceitas pela `p-tag` do PrimeNG. */
export type Severidade = 'success' | 'warn' | 'danger' | 'info' | 'secondary';

function opcoes<T extends string>(rotulos: Record<T, string>): OpcaoFiltro[] {
  return (Object.keys(rotulos) as T[]).map((valor) => ({ value: valor, label: rotulos[valor] }));
}

// ---------------------------------------------------------------------------
// Cadastro (RF-126/RF-127)
// ---------------------------------------------------------------------------

export const ROTULO_AMBIENTE: Record<IntegrationEnvironment, string> = {
  PRODUCAO: 'Produção',
  HOMOLOGACAO: 'Homologação',
  SANDBOX: 'Sandbox',
};

export const OPCOES_AMBIENTE = opcoes(ROTULO_AMBIENTE);

export const ROTULO_STATUS_INTEGRACAO: Record<IntegrationStatus, string> = {
  ATIVA: 'Ativa',
  SUSPENSA: 'Suspensa',
  ERRO: 'Com erro',
  INATIVA: 'Inativa',
};

export const OPCOES_STATUS_INTEGRACAO = opcoes(ROTULO_STATUS_INTEGRACAO);

const SEVERIDADE_STATUS: Record<IntegrationStatus, Severidade> = {
  ATIVA: 'success',
  SUSPENSA: 'warn',
  ERRO: 'danger',
  INATIVA: 'secondary',
};

export function severidadeStatus(status: IntegrationStatus): Severidade {
  return SEVERIDADE_STATUS[status];
}

/**
 * Chave de parâmetro com cara de credencial (RF-127).
 *
 * O mesmo padrão do backend, que por sua vez repete o trigger de bd/20 §3. Está
 * aqui para que a recusa apareça no campo em vez de virar 400 — e para que
 * ninguém cole um token no lugar errado por não saber que existe lugar certo:
 * segredo se cadastra como credencial cifrada, e nenhuma rota o devolve.
 */
export const CHAVE_SENSIVEL =
  /(senha|password|secret|segredo|token|api[_-]?key|chave[_-]?api|private[_-]?key|credential|credencial|authorization|passphrase)/i;

/** Limites do `CreateIntegrationDto`. */
export const LIMITES = {
  timeoutMs: { min: 500, max: 120_000, padrao: 10_000 },
  maxAttempts: { min: 1, max: 20, padrao: 5 },
  failureThreshold: { min: 1, max: 100, padrao: 10 },
} as const;

export const PADRAO_CODIGO = /^[A-Za-z0-9._-]+$/;

/** Um par de `parameters`, como a tela o edita. */
export interface ParametroEditavel {
  chave: string;
  valor: string;
}

export interface FormIntegracao {
  id: string | null;
  providerId: string;
  credentialId: string;
  code: string;
  name: string;
  environment: IntegrationEnvironment;
  timeoutMs: string;
  maxAttempts: string;
  failureThreshold: string;
  note: string;
  parametros: ParametroEditavel[];
}

export function formIntegracaoVazio(): FormIntegracao {
  return {
    id: null,
    providerId: '',
    credentialId: '',
    code: '',
    name: '',
    environment: 'PRODUCAO',
    timeoutMs: String(LIMITES.timeoutMs.padrao),
    maxAttempts: String(LIMITES.maxAttempts.padrao),
    failureThreshold: String(LIMITES.failureThreshold.padrao),
    note: '',
    parametros: [],
  };
}

export function formIntegracaoDe(integracao: Integration): FormIntegracao {
  return {
    id: integracao.id,
    providerId: integracao.provider.id,
    credentialId: integracao.credential?.id ?? '',
    code: integracao.code,
    name: integracao.name,
    environment: integracao.environment,
    timeoutMs: String(integracao.timeoutMs),
    maxAttempts: String(integracao.maxAttempts),
    failureThreshold: String(integracao.failureThreshold),
    note: integracao.note ?? '',
    parametros: Object.entries(integracao.parameters ?? {}).map(([chave, valor]) => ({
      chave,
      valor: typeof valor === 'string' ? valor : JSON.stringify(valor),
    })),
  };
}

function problemaInteiro(valor: string, limite: { min: number; max: number }, nome: string) {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < limite.min || numero > limite.max) {
    return `${nome} vai de ${limite.min} a ${limite.max}.`;
  }
  return null;
}

/** Valida os pares de `parameters` — chave repetida e chave sensível recusadas. */
export function problemaParametros(parametros: ParametroEditavel[]): string | null {
  const vistas = new Set<string>();
  for (const par of parametros) {
    const chave = par.chave.trim();
    if (chave === '') return 'Parâmetro sem nome: informe a chave ou remova a linha.';
    if (CHAVE_SENSIVEL.test(chave)) {
      return `"${chave}" tem nome de credencial. Segredo se cadastra como credencial cifrada, nunca como parâmetro.`;
    }
    if (vistas.has(chave)) return `A chave "${chave}" aparece duas vezes.`;
    vistas.add(chave);
  }
  return null;
}

export function problemaIntegracao(form: FormIntegracao): string | null {
  if (!form.providerId) return 'Escolha o provedor da integração.';
  if (form.name.trim().length < 2) return 'Dê um nome à integração.';

  if (form.id === null) {
    const codigo = form.code.trim();
    if (codigo === '') return 'Informe o código da integração.';
    if (!PADRAO_CODIGO.test(codigo)) {
      return 'O código aceita apenas letras, números, ponto, hífen e sublinhado.';
    }
  }

  return (
    problemaInteiro(form.timeoutMs, LIMITES.timeoutMs, 'O tempo limite, em ms,') ??
    problemaInteiro(form.maxAttempts, LIMITES.maxAttempts, 'O número de tentativas') ??
    problemaInteiro(
      form.failureThreshold,
      LIMITES.failureThreshold,
      'O limite de falhas seguidas',
    ) ??
    problemaParametros(form.parametros)
  );
}

/** Pares viram o objeto de `parameters`; valor vazio é string vazia, não `null`. */
export function montarParametros(parametros: ParametroEditavel[]): Record<string, unknown> {
  return Object.fromEntries(parametros.map((par) => [par.chave.trim(), par.valor]));
}

export function montarIntegracao(form: FormIntegracao): IntegrationInput {
  return {
    providerId: form.providerId,
    code: form.code.trim().toUpperCase(),
    name: form.name.trim(),
    environment: form.environment,
    timeoutMs: Number(form.timeoutMs),
    maxAttempts: Number(form.maxAttempts),
    failureThreshold: Number(form.failureThreshold),
    ...(form.credentialId ? { credentialId: form.credentialId } : {}),
    ...(form.parametros.length > 0 ? { parameters: montarParametros(form.parametros) } : {}),
    ...(form.note.trim() ? { note: form.note.trim() } : {}),
  };
}

/**
 * Só o que mudou vai na alteração — e nunca `code` nem `providerId`.
 *
 * O código é a referência estável que aparece em configuração e em log:
 * renomeá-lo quebraria o rastro de tudo o que já foi registrado com o nome
 * antigo. Situação também fica de fora: mudar situação é ativar, suspender ou
 * retomar, e cada uma delas registra o motivo.
 *
 * `parameters` não entra aqui: o conjunto inteiro é substituído por
 * `PATCH .../parameters`, para que metade dos parâmetros nunca seja gravada.
 */
export function montarEdicaoIntegracao(
  form: FormIntegracao,
  atual: Integration,
): IntegrationUpdate {
  const corpo: IntegrationUpdate = {};
  const nome = form.name.trim();
  if (nome !== atual.name) corpo.name = nome;
  if (form.environment !== atual.environment) corpo.environment = form.environment;

  const credencial = form.credentialId || undefined;
  if (credencial !== (atual.credential?.id ?? undefined)) corpo.credentialId = credencial;

  if (Number(form.timeoutMs) !== atual.timeoutMs) corpo.timeoutMs = Number(form.timeoutMs);
  if (Number(form.maxAttempts) !== atual.maxAttempts) {
    corpo.maxAttempts = Number(form.maxAttempts);
  }
  if (Number(form.failureThreshold) !== atual.failureThreshold) {
    corpo.failureThreshold = Number(form.failureThreshold);
  }

  const nota = form.note.trim();
  if (nota !== (atual.note ?? '')) corpo.note = nota;
  return corpo;
}

/** `true` quando os pares editados diferem do que está gravado. */
export function parametrosMudaram(form: FormIntegracao, atual: Integration): boolean {
  const gravados = JSON.stringify(
    Object.entries(atual.parameters ?? {})
      .map(([chave, valor]) => [chave, typeof valor === 'string' ? valor : JSON.stringify(valor)])
      .sort(),
  );
  const editados = JSON.stringify(
    form.parametros.map((par) => [par.chave.trim(), par.valor]).sort(),
  );
  return gravados !== editados;
}

// ---------------------------------------------------------------------------
// Monitoramento e diário (RF-128 a RF-130)
// ---------------------------------------------------------------------------

export const ROTULO_SEVERIDADE: Record<IntegrationEventSeverity, string> = {
  INFO: 'Informação',
  AVISO: 'Aviso',
  ERRO: 'Erro',
  CRITICO: 'Crítico',
};

export const OPCOES_SEVERIDADE = opcoes(ROTULO_SEVERIDADE);

const SEVERIDADE_EVENTO: Record<IntegrationEventSeverity, Severidade> = {
  INFO: 'info',
  AVISO: 'warn',
  ERRO: 'danger',
  CRITICO: 'danger',
};

export function severidadeEvento(severidade: IntegrationEventSeverity): Severidade {
  return SEVERIDADE_EVENTO[severidade] ?? 'info';
}

export const ROTULO_STATUS_JOB: Record<string, string> = {
  PENDENTE: 'Na fila',
  PROCESSANDO: 'Em execução',
  CONCLUIDO: 'Concluído',
  FALHA: 'Falhou',
  CANCELADO: 'Cancelado',
  AGENDADO: 'Agendado',
};

export function rotuloStatusJob(status: string): string {
  return ROTULO_STATUS_JOB[status] ?? status;
}

/** Motivo mínimo da suspensão — o backend exige texto não vazio. */
export function problemaSuspensao(motivo: string): string | null {
  return motivo.trim().length < 5 ? 'Explique por que a integração está sendo suspensa.' : null;
}
