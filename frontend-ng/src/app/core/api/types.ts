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

// ---------------------------------------------------------------------------
// Cadastros e Estoque (Sprint 21 — UI-018 a UI-023)
// ---------------------------------------------------------------------------

export type PersonType = 'PF' | 'PJ' | 'ESTRANGEIRO';

/** Papel exercido, usado como filtro da listagem (RF-022/RF-023). */
export type PartnerRole = 'CLIENTE' | 'FORNECEDOR';

export type PaymentMethodType =
  | 'PIX'
  | 'BOLETO'
  | 'TED'
  | 'DOC'
  | 'TRANSFERENCIA_INTERNA'
  | 'DEBITO_AUTOMATICO'
  | 'CARTAO_CREDITO'
  | 'CARTAO_DEBITO'
  | 'DINHEIRO'
  | 'CHEQUE'
  | 'COMPENSACAO'
  | 'OUTRO';

export type ItemType = 'PRODUTO' | 'SERVICO' | 'MATERIA_PRIMA' | 'ATIVO_IMOBILIZADO';

export type StockMovementType =
  | 'ENTRADA'
  | 'SAIDA'
  | 'TRANSFERENCIA_ENTRADA'
  | 'TRANSFERENCIA_SAIDA'
  | 'AJUSTE_POSITIVO'
  | 'AJUSTE_NEGATIVO'
  | 'INVENTARIO';

/** Tipos que o usuário pode lançar direto (`StockEntryType` do backend). */
export type StockEntryType = 'ENTRADA' | 'SAIDA' | 'AJUSTE_POSITIVO' | 'AJUSTE_NEGATIVO';

export type InventoryStatus = 'ABERTO' | 'EM_CONTAGEM' | 'CONCLUIDO' | 'CANCELADO';

export type PartnerAddressType = 'PRINCIPAL' | 'COBRANCA' | 'ENTREGA' | 'CORRESPONDENCIA';

/** Perfil do papel cliente (RF-022/RF-026) — `gestao.cliente`. */
export interface CustomerProfile {
  partnerId: string;
  /** Decimal canônico em string (RN-012). */
  creditLimit: string;
  paymentTermId: string | null;
  paymentMethodId: string | null;
  salesRepId: string | null;
  preferredDueDay: number | null;
  isBlocked: boolean;
  blockReason: string | null;
}

/** Perfil do papel fornecedor (RF-023/RF-026) — `gestao.fornecedor`. */
export interface SupplierProfile {
  partnerId: string;
  paymentTermId: string | null;
  paymentMethodId: string | null;
  deliveryDays: number | null;
  defaultCategoryId: string | null;
  isApproved: boolean;
  isBlocked: boolean;
  blockReason: string | null;
}

/**
 * Parceiro (RF-022 a RF-024) — `gestao.parceiro`.
 *
 * Tabela única com os dois papéis em flags: não existem "cliente" e
 * "fornecedor" como cadastros separados, e o mesmo parceiro pode exercer os
 * dois ao mesmo tempo.
 */
export interface Partner {
  id: string;
  companyId: string;
  personType: PersonType;
  code: string | null;
  legalName: string;
  tradeName: string | null;
  cnpj: string | null;
  cpf: string | null;
  foreignDocument: string | null;
  stateRegistration: string | null;
  municipalRegistration: string | null;
  icmsTaxpayer: boolean;
  taxRegime: TaxRegime | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  isCustomer: boolean;
  isSupplier: boolean;
  note: string | null;
  isActive: boolean;
  customer: CustomerProfile | null;
  supplier: SupplierProfile | null;
}

export interface CustomerProfileInput {
  creditLimit?: string;
  paymentTermId?: string;
  paymentMethodId?: string;
  salesRepId?: string;
  preferredDueDay?: number;
  isBlocked?: boolean;
  blockReason?: string;
}

export interface SupplierProfileInput {
  paymentTermId?: string;
  paymentMethodId?: string;
  deliveryDays?: number;
  defaultCategoryId?: string;
  isApproved?: boolean;
  isBlocked?: boolean;
  blockReason?: string;
}

export interface PartnerInput {
  personType: PersonType;
  code?: string;
  legalName: string;
  tradeName?: string;
  cnpj?: string;
  cpf?: string;
  foreignDocument?: string;
  stateRegistration?: string;
  municipalRegistration?: string;
  icmsTaxpayer?: boolean;
  taxRegime?: TaxRegime;
  email?: string;
  phone?: string;
  website?: string;
  isCustomer?: boolean;
  isSupplier?: boolean;
  note?: string;
  customer?: CustomerProfileInput;
  supplier?: SupplierProfileInput;
}

/** Endereço do parceiro (RF-024) — `gestao.endereco`. */
export interface PartnerAddress {
  id: string;
  type: PartnerAddressType;
  street: string;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string;
  state: string;
  zipCode: string | null;
  country: string;
  ibgeCode: string | null;
  isPrimary: boolean;
}

export interface PartnerAddressInput {
  type?: PartnerAddressType;
  street: string;
  number?: string;
  complement?: string;
  district?: string;
  city: string;
  state: string;
  zipCode?: string;
  country?: string;
  ibgeCode?: string;
  isPrimary?: boolean;
}

/** Contato do parceiro (RF-024) — `gestao.contato`. */
export interface PartnerContact {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  note: string | null;
  isPrimary: boolean;
}

export interface PartnerContactInput {
  name: string;
  role?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  note?: string;
  isPrimary?: boolean;
}

/** Resumo por lado do financeiro no histórico do parceiro (RF-025). */
export interface PartnerFinancialSide {
  count: number;
  netAmount: string;
  settledAmount: string;
  openBalance: string;
}

export interface PartnerHistory {
  partner: {
    id: string;
    legalName: string;
    isCustomer: boolean;
    isSupplier: boolean;
    isActive: boolean;
    customerBlocked: boolean | null;
    supplierBlocked: boolean | null;
    creditLimit: string | null;
    registeredAt: string;
  };
  period: { from: string | null; to: string | null };
  financial: {
    payable: PartnerFinancialSide;
    receivable: PartnerFinancialSide;
    /** O que ele nos deve menos o que devemos a ele. */
    netExposure: string;
  };
  commercial: {
    purchaseOrders: { count: number; totalAmount: string; lastOrderDate: string | null };
    recentOrders: {
      id: string;
      number: string;
      orderDate: string;
      totalAmount: string;
      status: string;
    }[];
  };
  recentEntries: {
    id: string;
    type: EntryType;
    number: string;
    description: string;
    issueDate: string;
    netAmount: string;
    settledAmount: string;
    balance: string;
    status: string;
  }[];
}

/** Condição de pagamento (RF-026) — `gestao.condicao_pagamento`. */
export interface PaymentTerm {
  id: string;
  code: string;
  name: string;
  installments: number;
  intervalDays: number;
  firstDueDays: number;
  /** Percentual canônico em string. */
  discountPercent: string;
  isActive: boolean;
}

export interface PaymentTermInput {
  code: string;
  name: string;
  installments?: number;
  intervalDays?: number;
  firstDueDays?: number;
  discountPercent?: string;
}

/** Forma de pagamento (RF-026) — `gestao.forma_pagamento`. */
export interface PaymentMethod {
  id: string;
  code: string;
  name: string;
  method: PaymentMethodType;
  isActive: boolean;
}

export interface PaymentMethodInput {
  code: string;
  name: string;
  method: PaymentMethodType;
}

/** Unidade de medida (RF-029) — `gestao.unidade_medida`. */
export interface UnitOfMeasure {
  id: string;
  symbol: string;
  description: string;
  isActive: boolean;
}

export interface UnitOfMeasureInput {
  symbol: string;
  description: string;
}

/** Categoria do catálogo (RF-029) — `gestao.categoria_produto`. */
export interface ProductCategory {
  id: string;
  parentId: string | null;
  code: string;
  name: string;
  isActive: boolean;
}

export interface ProductCategoryInput {
  code: string;
  name: string;
  parentId?: string;
}

/**
 * Item do catálogo (RF-028 a RF-030) — `gestao.produto`.
 *
 * Quantidades e preços unitários chegam com até 6 casas decimais
 * (`UNIT_VALUE_PATTERN`); dinheiro continua em 2.
 */
export interface Product {
  id: string;
  type: ItemType;
  code: string;
  barcode: string | null;
  description: string;
  extraDescription: string | null;
  categoryId: string | null;
  category: { id: string; code: string; name: string } | null;
  unitId: string | null;
  unit: { id: string; symbol: string; description: string } | null;
  ncm: string | null;
  cest: string | null;
  defaultInboundCfop: string | null;
  defaultOutboundCfop: string | null;
  goodsOrigin: number | null;
  serviceCodeLc116: string | null;
  averageCost: string;
  lastPurchaseCost: string | null;
  lastPurchaseDate: string | null;
  salePrice: string | null;
  defaultMargin: string | null;
  tracksStock: boolean;
  minStock: string;
  maxStock: string | null;
  netWeight: string | null;
  grossWeight: string | null;
  isActive: boolean;
}

export interface ProductInput {
  type?: ItemType;
  code: string;
  barcode?: string;
  description: string;
  extraDescription?: string;
  categoryId?: string;
  unitId?: string;
  ncm?: string;
  cest?: string;
  defaultInboundCfop?: string;
  defaultOutboundCfop?: string;
  goodsOrigin?: number;
  serviceCodeLc116?: string;
  salePrice?: string;
  defaultMargin?: string;
  tracksStock?: boolean;
  minStock?: string;
  maxStock?: string;
  netWeight?: string;
  grossWeight?: string;
}

/** Fornecedor homologado do item (RF-030) — `gestao.produto_fornecedor`. */
export interface ProductSupplier {
  id: string;
  productId: string;
  partnerId: string;
  partner: { id: string; legalName: string; tradeName: string | null } | null;
  supplierCode: string | null;
  referencePrice: string | null;
  deliveryDays: number | null;
  isPreferred: boolean;
}

export interface ProductSupplierInput {
  partnerId: string;
  supplierCode?: string;
  referencePrice?: string;
  deliveryDays?: number;
  isPreferred?: boolean;
}

/** Local de estoque (RF-031) — `gestao.local_estoque`. */
export interface StockLocation {
  id: string;
  branchId: string;
  branch: { id: string; code: string; name: string } | null;
  code: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
}

export interface StockLocationInput {
  branchId: string;
  code: string;
  name: string;
  isDefault?: boolean;
}

/** Saldo por item e local (RF-031) — `gestao.saldo_estoque`. */
export interface StockBalance {
  id: string;
  productId: string;
  product: {
    id: string;
    code: string;
    description: string;
    minStock: string;
    maxStock: string | null;
  } | null;
  locationId: string;
  location: {
    id: string;
    code: string;
    name: string;
    branch: { id: string; code: string; name: string } | null;
  } | null;
  quantity: string;
  reserved: string;
  averageCost: string;
  totalValue: string;
}

/** Item no ou abaixo do mínimo (RF-035). */
export interface StockAlert {
  productId: string;
  code: string;
  description: string;
  locationId: string;
  locationName: string;
  quantity: string;
  minStock: string;
  quantityToReplenish: string;
}

/** Valorização a custo médio (RF-034). */
export interface StockValuation {
  totalValue: string;
  locations: {
    location: { id: string; code?: string; name?: string; branch?: { id: string; name: string } };
    quantity: string;
    totalValue: string;
  }[];
}

/** Movimento do razão de estoque (RF-032) — append-only. */
export interface StockMovement {
  id: string;
  productId: string;
  product: { id: string; code: string; description: string } | null;
  locationId: string;
  location: { id: string; code: string; name: string } | null;
  counterpartId: string | null;
  counterpart: { id: string; code: string; name: string } | null;
  type: StockMovementType;
  movementDate: string;
  quantity: string;
  unitCost: string;
  totalValue: string;
  previousBalance: string | null;
  newBalance: string | null;
  origin: string | null;
  originId: string | null;
  batch: string | null;
  note: string | null;
  user: { id: string; name: string } | null;
}

export interface StockMovementInput {
  type: StockEntryType;
  productId: string;
  locationId: string;
  quantity: string;
  unitCost?: string;
  movementDate?: string;
  batch?: string;
  note?: string;
}

/** Transferência: uma operação com duas pernas, criadas juntas (RF-032). */
export interface StockTransferInput {
  productId: string;
  fromLocationId: string;
  toLocationId: string;
  quantity: string;
  movementDate?: string;
  batch?: string;
  note?: string;
}

/** Item contado do inventário (RF-033) — `gestao.inventario_item`. */
export interface InventoryItem {
  id: string;
  productId: string;
  product: { id: string; code: string; description: string } | null;
  systemQuantity: string;
  countedQuantity: string | null;
  difference: string;
  unitCost: string | null;
  isAdjusted: boolean;
  note: string | null;
}

/** Inventário (RF-033) — `gestao.inventario`. */
export interface Inventory {
  id: string;
  locationId: string;
  location: {
    id: string;
    code: string;
    name: string;
    branch: { id: string; code: string; name: string } | null;
  } | null;
  number: string;
  description: string | null;
  startedAt: string;
  finishedAt: string | null;
  status: InventoryStatus;
  responsibleId: string | null;
  responsible: { id: string; name: string } | null;
  items: InventoryItem[];
}

export interface InventoryInput {
  locationId: string;
  description?: string;
  responsibleId?: string;
  /** Escopo da contagem; vazio = todos os itens com saldo no local. */
  productIds?: string[];
}

export interface InventoryCountInput {
  counts: { productId: string; countedQuantity: string; note?: string }[];
}

// ---------------------------------------------------------------------------
// Financeiro — contas a pagar e receber (RF-051 a RF-058 — UI-024 a UI-028)
// ---------------------------------------------------------------------------

export type EntryStatus =
  'ABERTO' | 'PARCIALMENTE_LIQUIDADO' | 'LIQUIDADO' | 'CANCELADO' | 'RENEGOCIADO';

export type InstallmentStatus =
  'ABERTA' | 'PARCIALMENTE_LIQUIDADA' | 'LIQUIDADA' | 'CANCELADA' | 'RENEGOCIADA';

/** `NAO_REQUERIDA` = abaixo da alçada; `PENDENTE` bloqueia a baixa (RF-056). */
export type ApprovalStatus = 'NAO_REQUERIDA' | 'PENDENTE' | 'APROVADO' | 'REPROVADO' | 'CANCELADO';

export type AgingBucket = 'A_VENCER' | 'ATE_30' | 'DE_31_A_60' | 'DE_61_A_90' | 'ACIMA_DE_90';

export interface CodedRef {
  id: string;
  code: string;
  name: string;
}

/** Baixa da parcela (RF-057). Estorno é outra baixa, apontando para esta. */
export interface Settlement {
  id: string;
  installmentId: string;
  settlementDate: string;
  principalAmount: string;
  interestAmount: string;
  penaltyAmount: string;
  discountAmount: string;
  totalAmount: string;
  paymentMethodId: string | null;
  paymentMethod: CodedRef | null;
  method: PaymentMethodType | null;
  isReversed: boolean;
  reversalOfId: string | null;
  reversedAt: string | null;
  reversalReason: string | null;
  note: string | null;
  createdAt: string;
}

export interface FinancialInstallment {
  id: string;
  entryId: string;
  number: number;
  totalInstallments: number;
  dueDate: string;
  /** Vencimento combinado antes da primeira prorrogação — preservado pelo banco. */
  originalDueDate: string | null;
  amount: string;
  interestAmount: string;
  penaltyAmount: string;
  discountAmount: string;
  settledAmount: string;
  balance: string;
  /** Percentuais canônicos em string (até 6 casas). */
  dailyInterestRate: string;
  penaltyRate: string;
  settledAt: string | null;
  status: InstallmentStatus;
  barcode: string | null;
  digitableLine: string | null;
  bankIdentifier: string | null;
  note: string | null;
  settlements: Settlement[];
}

/** Título (`gestao.titulo`) — uma entidade só para as duas carteiras. */
export interface FinancialEntry {
  id: string;
  type: EntryType;
  number: string;
  documentReference: string | null;
  description: string;
  partnerId: string | null;
  partner: { id: string; legalName: string; tradeName: string | null } | null;
  employeeId: string | null;
  employee: { id: string; registration: string; name: string } | null;
  branchId: string | null;
  branch: CodedRef | null;
  issueDate: string;
  competenceDate: string;
  grossAmount: string;
  discountAmount: string;
  netAmount: string;
  settledAmount: string;
  balance: string;
  categoryId: string | null;
  category: (CodedRef & { type: EntryType }) | null;
  costCenterId: string | null;
  costCenter: CodedRef | null;
  /** Herdada da categoria (RF-054/RF-080) — não é digitada no título. */
  ledgerAccountId: string | null;
  paymentMethodId: string | null;
  paymentMethod: (CodedRef & { method: PaymentMethodType }) | null;
  paymentTermId: string | null;
  paymentTerm: CodedRef | null;
  origin: string | null;
  status: EntryStatus;
  approvalStatus: ApprovalStatus;
  canceledAt: string | null;
  cancelReason: string | null;
  note: string | null;
  createdById: string | null;
  createdAt: string;
  installments: FinancialInstallment[];
}

export interface FinancialInstallmentInput {
  dueDate: string;
  amount: string;
  dailyInterestRate?: string;
  penaltyRate?: string;
  barcode?: string;
  digitableLine?: string;
  bankIdentifier?: string;
  note?: string;
}

/**
 * Criação do título (`CreateFinancialEntryDto`). As parcelas saem da lista
 * explícita, da condição de pagamento ou do parcelamento simples — nessa ordem.
 */
export interface FinancialEntryInput {
  type: EntryType;
  description: string;
  partnerId?: string;
  employeeId?: string;
  branchId?: string;
  documentReference?: string;
  issueDate?: string;
  competenceDate?: string;
  grossAmount: string;
  discountAmount?: string;
  categoryId?: string;
  costCenterId?: string;
  paymentMethodId?: string;
  paymentTermId?: string;
  installments?: FinancialInstallmentInput[];
  installmentCount?: number;
  firstDueDate?: string;
  intervalDays?: number;
  dailyInterestRate?: string;
  penaltyRate?: string;
  note?: string;
}

/** Edição (`UpdateFinancialEntryDto`): tipo, número e contraparte não mudam. */
export interface FinancialEntryUpdateInput {
  description?: string;
  documentReference?: string;
  competenceDate?: string;
  grossAmount?: string;
  discountAmount?: string;
  branchId?: string;
  categoryId?: string;
  costCenterId?: string;
  paymentMethodId?: string;
  note?: string;
}

export interface InstallmentUpdateInput {
  dueDate?: string;
  dailyInterestRate?: string;
  penaltyRate?: string;
  barcode?: string;
  digitableLine?: string;
  bankIdentifier?: string;
  note?: string;
}

/** Baixa (`CreateSettlementDto`): só o principal abate o saldo da parcela. */
export interface SettlementInput {
  principalAmount: string;
  interestAmount?: string;
  penaltyAmount?: string;
  discountAmount?: string;
  applyLateCharges?: boolean;
  settlementDate?: string;
  paymentMethodId?: string;
  method?: PaymentMethodType;
  note?: string;
}

/** Linha de `vw_parcela_posicao` (RF-055/RF-058). */
export interface PortfolioInstallment {
  installmentId: string;
  entryId: string;
  type: EntryType;
  number: string;
  description: string;
  partner: { id: string; legalName: string | null } | null;
  installmentNumber: number;
  totalInstallments: number;
  dueDate: string;
  originalDueDate: string | null;
  amount: string;
  settledAmount: string;
  balance: string;
  status: InstallmentStatus;
  daysOverdue: number;
  lateCharges: string;
  updatedBalance: string;
  agingBucket: AgingBucket | string;
}

export interface DelinquencyBucket {
  bucket: AgingBucket;
  installments: number;
  balance: string;
  updatedBalance: string;
}

export interface DelinquencySummary {
  aging: DelinquencyBucket[];
  totals: { installments: number; balance: string; updatedBalance: string };
  partners: {
    partner: { id: string; legalName: string | null } | null;
    installments: number;
    balance: string;
    updatedBalance: string;
    maxDaysOverdue: number;
  }[];
}

/** Origem financeira e a conta contábil dela (RF-080). */
export interface CategoryClassification {
  id: string;
  code: string;
  name: string;
  ledgerAccountId: string | null;
  ledgerAccountCode: string | null;
  ledgerAccountName: string | null;
}

// ---------------------------------------------------------------------------
// Fluxo de caixa (RF-101 a RF-105 — UI-029)
// ---------------------------------------------------------------------------

export type CashSituation = 'REALIZADO' | 'VENCIDO' | 'PREVISTO';

export type CashFlowGranularity = 'DIA' | 'SEMANA' | 'MES';

export interface CashFlowSummary {
  period: { from: string; to: string };
  bySituation: {
    situation: CashSituation;
    inflow: string;
    outflow: string;
    net: string;
    movements: number;
  }[];
  totals: { inflow: string; outflow: string; net: string };
  byCategory: {
    category: CodedRef | null;
    inflow: string;
    outflow: string;
    net: string;
  }[];
}

export interface CashFlowSide {
  realized: string;
  expected: string;
  overdue: string;
  total: string;
}

export interface CashFlowPeriod {
  periodStart: string;
  inflow: CashFlowSide;
  outflow: CashFlowSide;
  net: string;
  closingBalance: string;
}

export interface ScenarioAssumptions {
  /** Percentuais de -100 a 100 — número, como o backend valida (`IsNumber`). */
  entradas_percentual?: number;
  saidas_percentual?: number;
}

export interface CashFlowProjection {
  period: { from: string; to: string };
  granularity: CashFlowGranularity;
  scenario: { id: string; name: string; assumptions: ScenarioAssumptions | null } | null;
  openingBalance: string;
  closingBalance: string;
  periods: CashFlowPeriod[];
}

export interface CashScenario {
  id: string;
  name: string;
  description: string | null;
  startDate: string;
  endDate: string;
  openingBalance: string | null;
  assumptions: ScenarioAssumptions | null;
  isBaseline: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CashScenarioInput {
  name: string;
  description?: string;
  startDate: string;
  endDate: string;
  openingBalance?: string;
  assumptions?: ScenarioAssumptions;
  isBaseline?: boolean;
}

/** Movimento manual do cenário: sempre PREVISTO; a direção vem do tipo. */
export interface CashProjection {
  id: string;
  scenarioId: string;
  referenceDate: string;
  type: EntryType;
  amount: string;
  description: string | null;
  category: CodedRef | null;
  costCenter: CodedRef | null;
}

export interface CashProjectionInput {
  referenceDate: string;
  type: EntryType;
  amount: string;
  description?: string;
  categoryId?: string;
  costCenterId?: string;
}

export interface CashAlert {
  id: string;
  name: string;
  bankAccountId: string | null;
  minimumBalance: string;
  daysAhead: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CashAlertInput {
  name: string;
  bankAccountId?: string;
  minimumBalance: string;
  daysAhead?: number;
  isActive?: boolean;
}

export interface CashAlertEvaluation {
  alert: {
    id: string;
    name: string;
    bankAccountId: string | null;
    minimumBalance: string;
    daysAhead: number;
  };
  horizon: { from: string; to: string };
  openingBalance: string;
  closingBalance: string;
  lowestBalance: string;
  lowestBalanceDate: string | null;
  breached: boolean;
  breachDate: string | null;
}

export interface CashAlertEvaluationSummary {
  evaluatedAt: string;
  breached: number;
  alerts: CashAlertEvaluation[];
}
