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

// ---------------------------------------------------------------------------
// Administração (Sprint 19 — UI-007 a UI-012)
// ---------------------------------------------------------------------------

export type TaxRegime =
  'SIMPLES_NACIONAL' | 'LUCRO_PRESUMIDO' | 'LUCRO_REAL' | 'MEI' | 'IMUNE_ISENTO';

export type EntryType = 'PAGAR' | 'RECEBER';

export type SettingScope = 'FINANCEIRO' | 'FISCAL' | 'GERAL';

/** Endereço principal devolvido junto de empresa e filial (`gestao.endereco`). */
export interface AddressPayload {
  id: string;
  street: string;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string;
  state: string;
  zipCode: string | null;
  country: string;
  isPrimary: boolean;
}

/** Campos de endereço aceitos nos DTOs de empresa e filial (`AddressDto`). */
export interface AddressInput {
  addressStreet?: string;
  addressNumber?: string;
  addressComplement?: string;
  addressDistrict?: string;
  addressCity?: string;
  addressState?: string;
  addressZipCode?: string;
  addressCountry?: string;
}

export interface Company {
  id: string;
  legalName: string;
  tradeName: string | null;
  taxId: string | null;
  stateRegistration: string | null;
  municipalRegistration: string | null;
  taxRegime: TaxRegime | null;
  mainCnae: string | null;
  email: string | null;
  phone: string | null;
  timezone: string;
  currency: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  /** Só vem no detalhe (`GET /companies/:id`), não na listagem. */
  addresses?: AddressPayload[];
}

export interface CompanyInput extends AddressInput {
  legalName: string;
  tradeName?: string;
  taxId?: string;
  stateRegistration?: string;
  municipalRegistration?: string;
  taxRegime?: TaxRegime;
  mainCnae?: string;
  email?: string;
  phone?: string;
}

export interface Branch {
  id: string;
  companyId: string;
  code: string;
  name: string;
  taxId: string | null;
  stateRegistration: string | null;
  municipalRegistration: string | null;
  isHeadquarters: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  addresses?: AddressPayload[];
}

export interface BranchInput extends AddressInput {
  code: string;
  name: string;
  taxId?: string;
  stateRegistration?: string;
  municipalRegistration?: string;
  isHeadquarters?: boolean;
}

export interface Category {
  id: string;
  companyId: string;
  parentId: string | null;
  code: string;
  name: string;
  type: EntryType;
  acceptsEntry: boolean;
  isActive: boolean;
}

export interface CategoryInput {
  code: string;
  name: string;
  type: EntryType;
  parentId?: string;
  acceptsEntry?: boolean;
}

export interface CostCenter {
  id: string;
  companyId: string;
  parentId: string | null;
  branchId: string | null;
  code: string;
  name: string;
  description: string | null;
  acceptsEntry: boolean;
  isActive: boolean;
}

export interface CostCenterInput {
  code: string;
  name: string;
  description?: string;
  parentId?: string;
  branchId?: string;
  acceptsEntry?: boolean;
}

export interface CompanySetting {
  id: string;
  companyId: string;
  scope: SettingScope;
  key: string;
  /** `jsonb` no banco: string, número, booleano ou objeto. */
  value: unknown;
  description: string | null;
  updatedAt: string;
}

export interface SettingInput {
  scope: SettingScope;
  key: string;
  value: unknown;
  description?: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  isSuperAdmin: boolean;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  phone?: string;
  isSuperAdmin?: boolean;
}

export interface UpdateUserInput {
  name?: string;
  phone?: string;
  isActive?: boolean;
  isSuperAdmin?: boolean;
}

/** Vínculo usuário ↔ empresa (`gestao.usuario_empresa`). */
export interface MembershipRow {
  id: string;
  userId: string;
  companyId: string;
  roleId: string;
  branchId: string | null;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  user: { id: string; name: string; email: string; isActive: boolean };
  role: { id: string; name: string };
  branch: { id: string; code: string; name: string } | null;
}

export interface CreateMembershipInput {
  userId: string;
  roleId: string;
  branchId?: string;
  isDefault?: boolean;
  isActive?: boolean;
}

export interface UpdateMembershipInput {
  roleId?: string;
  branchId?: string;
  isDefault?: boolean;
  isActive?: boolean;
}

export interface Role {
  id: string;
  companyId: string | null;
  name: string;
  description: string | null;
  isSystem: boolean;
  isActive: boolean;
  /** Códigos `recurso:AÇÃO` concedidos ao perfil (RF-011). */
  permissions: string[];
}

export interface RoleInput {
  name: string;
  description?: string;
  permissions: string[];
}

/** Item do catálogo global de permissões (`GET /permissions`). */
export interface PermissionCatalogItem {
  code: string;
  module: string;
  resource: string;
  action: string;
  description: string;
}

export interface ApprovalThreshold {
  id: string;
  name: string;
  operation: string;
  /** Decimais canônicos em string (RN-012) — nunca `number`. */
  minAmount: string;
  maxAmount: string | null;
  level: number;
  minApprovers: number;
  isActive: boolean;
  requiredRoles: { id: string; name: string }[];
}

export interface ApprovalThresholdInput {
  operation: string;
  name?: string;
  minAmount?: string;
  maxAmount?: string;
  requiredRoleId: string;
  level?: number;
  minApprovers?: number;
}

export type AuditEventType =
  | 'CRIACAO'
  | 'ALTERACAO'
  | 'EXCLUSAO'
  | 'APROVACAO'
  | 'REPROVACAO'
  | 'PAGAMENTO'
  | 'RECEBIMENTO'
  | 'CANCELAMENTO'
  | 'ESTORNO'
  | 'LOGIN'
  | 'LOGOUT'
  | 'ACESSO_NEGADO'
  | 'EXPORTACAO'
  | 'IMPORTACAO'
  | 'FECHAMENTO'
  | 'REABERTURA';

/** Evento da trilha (RF-114 a RF-118). `id` é bigint: chega como string. */
export interface AuditEntry {
  id: string;
  event: AuditEventType;
  entity: string;
  entityId: string | null;
  userId: string | null;
  userName: string | null;
  previousValue: unknown;
  currentValue: unknown;
  changedFields: string[];
  origin: string | null;
  ip: string | null;
  userAgent: string | null;
  correlationId: string | null;
  note: string | null;
  occurredAt: string;
}
