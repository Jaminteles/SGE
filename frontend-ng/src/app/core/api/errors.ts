/**
 * Tradução do envelope de erro da API (`AllExceptionsFilter` do backend) para
 * algo exibível (UI-005). O backend responde:
 * `{ statusCode, error, message, path, timestamp }`, com `message` string ou
 * array (erros de validação do class-validator).
 */

export interface ApiErrorBody {
  statusCode?: number;
  error?: string;
  message?: string | string[];
  path?: string;
  timestamp?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: string[];

  /**
   * Correlation id da requisição que falhou (RNF-010 — UI-090).
   *
   * Preenchido pelo `correlationInterceptor` no caminho de volta: é o mesmo id
   * que o backend usou nos logs daquela requisição, e o que o usuário informa
   * ao suporte. Mutável porque o erro é construído antes de voltar por lá.
   */
  correlationId: string | null = null;

  constructor(
    status: number,
    message: string,
    options: { code?: string; details?: string[] } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = options.code ?? 'Error';
    this.details = options.details ?? [];
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }
}

/** Erro de rede/timeout — a requisição nem chegou a ter resposta. */
export class NetworkError extends ApiError {
  constructor(message = 'Não foi possível falar com o servidor. Verifique sua conexão.') {
    super(0, message, { code: 'NetworkError' });
    this.name = 'NetworkError';
  }
}

const FALLBACK_BY_STATUS: Record<number, string> = {
  400: 'Requisição inválida.',
  401: 'Sua sessão expirou. Entre novamente.',
  403: 'Você não tem permissão para esta ação.',
  404: 'Registro não encontrado.',
  409: 'O registro já existe ou foi alterado por outra pessoa.',
  422: 'Não foi possível processar os dados enviados.',
  429: 'Muitas tentativas. Aguarde um instante e tente de novo.',
  500: 'Erro interno do servidor. Tente novamente em instantes.',
  503: 'Serviço indisponível no momento.',
};

/** Título curto para o alerta, no tom das telas ("Não foi possível salvar..."). */
export function errorTitle(error: unknown): string {
  if (error instanceof NetworkError) return 'Sem conexão com o servidor';
  if (error instanceof ApiError) {
    if (error.isForbidden) return 'Acesso negado';
    if (error.isNotFound) return 'Registro não encontrado';
    if (error.status === 401) return 'Sessão expirada';
    if (error.status >= 500) return 'Erro no servidor';
    return 'Não foi possível concluir a operação';
  }
  return 'Ocorreu um erro inesperado';
}

/** Mensagem exibível para qualquer erro, sem vazar detalhe interno. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  return 'Ocorreu um erro inesperado.';
}

/** Constrói o ApiError a partir do corpo devolvido pela API. */
export function toApiError(status: number, body: unknown): ApiError {
  const parsed = (typeof body === 'object' && body !== null ? body : {}) as ApiErrorBody;
  const rawMessage = parsed.message;
  const details = Array.isArray(rawMessage) ? rawMessage : [];
  const message =
    (Array.isArray(rawMessage) ? rawMessage[0] : rawMessage) ??
    FALLBACK_BY_STATUS[status] ??
    'Ocorreu um erro inesperado.';
  return new ApiError(status, message, { code: parsed.error ?? 'Error', details });
}
