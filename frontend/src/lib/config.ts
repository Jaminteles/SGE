/** Configuração pública do app (nunca guarde segredo aqui — o bundle é público). */
export const config = {
  /** Base da API REST. O proxy do Vite atende `/api/v1` em desenvolvimento. */
  apiUrl: import.meta.env.VITE_API_URL ?? '/api/v1',
  /** Cabeçalho da empresa ativa exigido pelas rotas multiempresa (RF-005). */
  companyHeader: 'x-company-id',
  /** Antecedência do aviso de expiração da sessão (UI-005). */
  sessionWarningMs: 2 * 60 * 1000,
} as const;
