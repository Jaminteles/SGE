/** Contratos da API consumidos pela interface (espelham os DTOs do backend). */

/** Envelope padrão de listagem paginada (RNF-008). */
export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface Membership {
  companyId: string;
  branchId: string | null;
  isDefault: boolean;
  company: {
    legalName: string;
    tradeName: string | null;
    taxId: string | null;
    isActive: boolean;
  };
  role: { id: string; name: string };
  /** Códigos `recurso:AÇÃO` do perfil nesta empresa (RF-011). */
  permissions: string[];
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  isSuperAdmin: boolean;
  isActive: boolean;
  memberships: Membership[];
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
}

export interface LoginResponse extends AuthTokens {
  user: UserProfile;
}

export interface MessageResponse {
  message: string;
}
