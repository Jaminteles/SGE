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

// ---------------------------------------------------------------------------
// RH (Sprint 20 — UI-013 a UI-017)
// ---------------------------------------------------------------------------

export type EmployeeStatus = 'ATIVO' | 'AFASTADO' | 'FERIAS' | 'DESLIGADO';

export type ContractType = 'CLT' | 'PJ' | 'ESTAGIO' | 'TEMPORARIO' | 'APRENDIZ';

export type HrEventType =
  | 'ADMISSAO'
  | 'PROMOCAO'
  | 'TRANSFERENCIA'
  | 'AFASTAMENTO'
  | 'FERIAS'
  | 'RETORNO'
  | 'DESLIGAMENTO'
  | 'ALTERACAO_SALARIAL';

export type PayrollItemType = 'SALARIO' | 'BENEFICIO' | 'DESCONTO' | 'ADICIONAL' | 'ENCARGO';

export type ReimbursementStatus =
  'RASCUNHO' | 'SOLICITADO' | 'EM_ANALISE' | 'APROVADO' | 'REPROVADO' | 'PAGO' | 'CANCELADO';

/** Referência enxuta devolvida nos `include` do backend. */
export interface NamedRef {
  id: string;
  code: string;
  name: string;
}

export interface Department {
  id: string;
  companyId: string;
  parentId: string | null;
  costCenterId: string | null;
  code: string;
  name: string;
  isActive: boolean;
}

export interface DepartmentInput {
  code: string;
  name: string;
  parentId?: string;
  costCenterId?: string;
}

export interface Position {
  id: string;
  companyId: string;
  code: string;
  name: string;
  cbo: string | null;
  description: string | null;
  /** Decimais canônicos em string (RN-012) — nunca `number`. */
  minSalary: string | null;
  maxSalary: string | null;
  isActive: boolean;
}

export interface PositionInput {
  code: string;
  name: string;
  cbo?: string;
  description?: string;
  minSalary?: string;
  maxSalary?: string;
}

/** Funcionário (RF-013 a RF-016) — `gestao.funcionario`. */
export interface Employee {
  id: string;
  companyId: string;
  branchId: string | null;
  userId: string | null;
  registration: string;
  name: string;
  taxId: string;
  rg: string | null;
  pis: string | null;
  birthDate: string | null;
  corporateEmail: string | null;
  phone: string | null;
  positionId: string | null;
  position: NamedRef | null;
  departmentId: string | null;
  department: NamedRef | null;
  costCenterId: string | null;
  managerId: string | null;
  manager: { id: string; registration: string; name: string } | null;
  hireDate: string;
  terminationDate: string | null;
  terminationReason: string | null;
  contractType: ContractType | null;
  status: EmployeeStatus;
  /** Decimal canônico em string (RN-012). */
  baseSalary: string | null;
}

/**
 * Cadastro funcional. `hireDate` e `baseSalary` só existem na criação: depois
 * viram evento do histórico (RF-015/RF-017) e o backend recusa os dois no PATCH.
 */
export interface EmployeeInput {
  registration: string;
  name: string;
  taxId: string;
  rg?: string;
  pis?: string;
  birthDate?: string;
  corporateEmail?: string;
  phone?: string;
  positionId?: string;
  departmentId?: string;
  costCenterId?: string;
  managerId?: string;
  branchId?: string;
  userId?: string;
  hireDate: string;
  contractType?: ContractType;
  baseSalary?: string;
}

export interface TerminateEmployeeInput {
  terminationDate: string;
  reason: string;
  note?: string;
}

/** Evento do histórico funcional (RF-015/RF-020) — append-only. */
export interface EmployeeEvent {
  id: string;
  employeeId: string;
  type: HrEventType;
  startDate: string;
  endDate: string | null;
  positionId: string | null;
  departmentId: string | null;
  costCenterId: string | null;
  salary: string | null;
  note: string | null;
  recordedBy: string | null;
  createdAt: string;
}

/** ADMISSAO e DESLIGAMENTO não entram aqui: nascem de outros caminhos. */
export interface EmployeeEventInput {
  type: Exclude<HrEventType, 'ADMISSAO' | 'DESLIGAMENTO'>;
  startDate: string;
  endDate?: string;
  positionId?: string;
  departmentId?: string;
  costCenterId?: string;
  salary?: string;
  note?: string;
}

export type BankAccountType = 'CORRENTE' | 'POUPANCA' | 'PAGAMENTO';

export type PixKeyType = 'CPF' | 'CNPJ' | 'EMAIL' | 'TELEFONE' | 'ALEATORIA';

/** Dado bancário do funcionário (RF-013) — `gestao.dado_bancario`. */
export interface BankAccount {
  id: string;
  bankCode: string | null;
  bankName: string | null;
  agency: string | null;
  agencyDigit: string | null;
  account: string | null;
  accountDigit: string | null;
  accountType: BankAccountType | null;
  holderName: string | null;
  holderDocument: string | null;
  pixKey: string | null;
  pixKeyType: PixKeyType | null;
  isPrimary: boolean;
  isActive: boolean;
}

export interface BankAccountInput {
  bankCode?: string;
  bankName?: string;
  agency?: string;
  agencyDigit?: string;
  account?: string;
  accountDigit?: string;
  accountType?: BankAccountType;
  holderName?: string;
  holderDocument?: string;
  pixKey?: string;
  pixKeyType?: PixKeyType;
  isPrimary?: boolean;
}

/** Verba do catálogo da empresa (RF-017) — `gestao.verba`. */
export interface PayrollItem {
  id: string;
  code: string;
  name: string;
  type: PayrollItemType;
  categoryId: string | null;
  ledgerAccountId: string | null;
  affectsInss: boolean;
  affectsIrrf: boolean;
  affectsFgts: boolean;
  isActive: boolean;
}

export interface PayrollItemInput {
  code: string;
  name: string;
  type: PayrollItemType;
  categoryId?: string;
  ledgerAccountId?: string;
  affectsInss?: boolean;
  affectsIrrf?: boolean;
  affectsFgts?: boolean;
}

/** Verba atribuída a um funcionário, com vigência (RF-017). */
export interface Compensation {
  id: string;
  employeeId: string;
  payrollItemId: string;
  payrollItem: { id: string; code: string; name: string; type: PayrollItemType };
  amount: string | null;
  percentage: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  note: string | null;
}

export interface CompensationInput {
  payrollItemId: string;
  amount?: string;
  percentage?: string;
  effectiveFrom: string;
  effectiveTo?: string;
  note?: string;
}

/** Linha da consolidação de folha (RF-021) — `GET /payroll/summary`. */
export interface PayrollLine {
  payrollItemId: string | null;
  code: string;
  name: string;
  type: PayrollItemType;
  amount: string;
  categoryId: string | null;
  ledgerAccountId: string | null;
  affectsInss: boolean;
  affectsIrrf: boolean;
  affectsFgts: boolean;
}

export interface PayrollEmployeeSummary {
  employeeId: string;
  registration: string;
  name: string;
  taxId: string;
  positionId: string | null;
  departmentId: string | null;
  costCenterId: string | null;
  status: EmployeeStatus;
  hireDate: string;
  terminationDate: string | null;
  lines: PayrollLine[];
  totals: {
    earnings: string;
    deductions: string;
    employerCharges: string;
    net: string;
    inssBase: string;
    irrfBase: string;
    fgtsBase: string;
  };
}

export interface PayrollSummary {
  competence: string;
  periodStart: string;
  periodEnd: string;
  employees: PayrollEmployeeSummary[];
  totals: {
    employees: number;
    earnings: string;
    deductions: string;
    employerCharges: string;
    net: string;
  };
}

/** Comprovante anexado à despesa (RF-019). */
export interface ReceiptDocument {
  id: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
}

export interface ReimbursementItem {
  id: string;
  description: string;
  expenseDate: string;
  amount: string;
  categoryId: string | null;
  costCenterId: string | null;
  documentId: string | null;
  document: ReceiptDocument | null;
  approved: boolean | null;
  note: string | null;
}

/** Solicitação de reembolso (RF-018/RF-019) — número e total vêm do servidor. */
export interface Reimbursement {
  id: string;
  branchId: string | null;
  employeeId: string;
  employee: { id: string; registration: string; name: string; userId: string | null };
  number: string;
  description: string;
  requestDate: string;
  totalAmount: string;
  approvedAmount: string | null;
  status: ReimbursementStatus;
  costCenterId: string | null;
  payableId: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  note: string | null;
  items: ReimbursementItem[];
}

export interface ReimbursementItemInput {
  description: string;
  expenseDate: string;
  amount: string;
  categoryId?: string;
  costCenterId?: string;
  note?: string;
}

export interface ReimbursementInput {
  employeeId: string;
  description: string;
  branchId?: string;
  costCenterId?: string;
  note?: string;
  items: ReimbursementItemInput[];
}
