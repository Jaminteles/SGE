import { environment } from '../../../environments/environment';

/** Configuração pública do app (nunca guarde segredo aqui — o bundle é público). */
export const config = {
  /** Base da API REST. O proxy do `ng serve` atende `/api/v1` em desenvolvimento. */
  apiUrl: environment.apiUrl,
  /** Cabeçalho da empresa ativa exigido pelas rotas multiempresa (RF-005). */
  companyHeader: 'x-company-id',
  /** Antecedência do aviso de expiração da sessão (UI-005). */
  sessionWarningMs: 2 * 60 * 1000,
  /**
   * Inatividade que encerra a sessão (RNF-002 — UI-089). Trinta minutos é o
   * intervalo em que um usuário do financeiro sai para uma reunião e volta;
   * acima disso a tela está abandonada.
   */
  sessionIdleMs: 30 * 60 * 1000,
  /** Renova o token com esta antecedência enquanto houver atividade (UI-089). */
  sessionRenewAheadMs: 60 * 1000,
  /** Intervalo do relógio que avalia inatividade e renovação (UI-089). */
  sessionCheckMs: 30 * 1000,
} as const;
