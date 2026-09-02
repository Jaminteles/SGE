/**
 * Empresa ativa da sessão (RF-005 / UI-003).
 *
 * Fica fora do React porque o cliente HTTP também precisa dela para mandar o
 * cabeçalho `x-company-id` em toda requisição. É só um identificador de escolha
 * de contexto: quem decide se o usuário pode usar essa empresa é o backend
 * (PermissionsGuard + RLS).
 */

const STORAGE_KEY = 'sge.activeCompanyId';

let activeCompanyId: string | null = null;
function safeLocal(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export const activeCompanyStore = {
  /** Lê da memória e, na primeira chamada, restaura a última escolha. */
  get(): string | null {
    if (activeCompanyId === null) {
      activeCompanyId = safeLocal()?.getItem(STORAGE_KEY) ?? null;
    }
    return activeCompanyId;
  },

  set(companyId: string | null): void {
    activeCompanyId = companyId;
    if (companyId === null) safeLocal()?.removeItem(STORAGE_KEY);
    else safeLocal()?.setItem(STORAGE_KEY, companyId);
  },
};
