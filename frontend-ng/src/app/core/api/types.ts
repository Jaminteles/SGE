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
  /** Pedido de compra que originou o título (RF-041), quando houver. */
  purchaseOrderId?: string | null;
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

/** Resultado de `GET /approval-thresholds/evaluate` (RF-012). */
export interface ApprovalEvaluation {
  operation: string;
  amount: string;
  requiresApproval: boolean;
  authorizedRoles: { id: string; name: string }[];
  matchedThresholds: ApprovalThreshold[];
}

// ---------------------------------------------------------------------------
// Compras — pedidos, recebimento e histórico (RF-036 a RF-042 — UI-030 a UI-035)
// ---------------------------------------------------------------------------

export type PurchaseOrderStatus =
  | 'RASCUNHO'
  | 'AGUARDANDO_APROVACAO'
  | 'APROVADO'
  | 'REPROVADO'
  | 'PARCIALMENTE_RECEBIDO'
  | 'RECEBIDO'
  | 'CANCELADO';

/** Item negociado do pedido (RF-037). `lineAmount` é calculado pelo banco. */
export interface PurchaseOrderItem {
  id: string;
  orderId: string;
  sequence: number;
  productId: string | null;
  product: { id: string; code: string; description: string; tracksStock: boolean } | null;
  description: string;
  /** Quantidades e preço unitário com até 6 casas; valores com 2 (RN-012). */
  quantity: string;
  receivedQuantity: string;
  unitPrice: string;
  discountAmount: string;
  /** Parcela do frete/seguro/despesas do pedido — rateio feito pelo banco. */
  apportionedFreight: string;
  lineAmount: string;
  costCenterId: string | null;
  costCenter: CodedRef | null;
  locationId: string | null;
  location: CodedRef | null;
  note: string | null;
}

/** Entrega registrada para o pedido, como vem no detalhe dele. */
export interface PurchaseOrderReceiptRef {
  id: string;
  number: string;
  receivedAt: string;
  hasDivergence: boolean;
  generatedStock: boolean;
  generatedPayable: boolean;
}

/** Pedido de compra (`gestao.pedido_compra`). Totais projetados pelo banco. */
export interface PurchaseOrder {
  id: string;
  number: string;
  partnerId: string;
  partner: { id: string; legalName: string; tradeName: string | null } | null;
  branchId: string | null;
  branch: CodedRef | null;
  /** Quem abriu o pedido — não pode aprová-lo (RN-003). */
  requesterId: string | null;
  requester: { id: string; name: string } | null;
  buyerId: string | null;
  buyer: { id: string; registration: string; name: string } | null;
  orderDate: string;
  expectedDate: string | null;
  paymentTermId: string | null;
  paymentTerm: CodedRef | null;
  paymentMethodId: string | null;
  paymentMethod: (CodedRef & { method: PaymentMethodType }) | null;
  costCenterId: string | null;
  costCenter: CodedRef | null;
  categoryId: string | null;
  category: (CodedRef & { type: EntryType }) | null;
  productsAmount: string;
  discountAmount: string;
  freightAmount: string;
  insuranceAmount: string;
  otherExpenseAmount: string;
  totalAmount: string;
  status: PurchaseOrderStatus;
  approvalStatus: ApprovalStatus;
  approvedById: string | null;
  approvedBy: { id: string; name: string } | null;
  approvedAt: string | null;
  note: string | null;
  canceledAt: string | null;
  cancelReason: string | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  items: PurchaseOrderItem[];
  receipts: PurchaseOrderReceiptRef[];
}

export interface PurchaseOrderItemInput {
  productId?: string;
  description?: string;
  quantity: string;
  unitPrice: string;
  discountAmount?: string;
  costCenterId?: string;
  locationId?: string;
  note?: string;
}

/** `CreatePurchaseOrderDto` — não há total: ele é do banco. */
export interface PurchaseOrderInput {
  partnerId: string;
  branchId?: string;
  buyerId?: string;
  orderDate?: string;
  expectedDate?: string;
  paymentTermId?: string;
  paymentMethodId?: string;
  costCenterId?: string;
  categoryId?: string;
  discountAmount?: string;
  freightAmount?: string;
  insuranceAmount?: string;
  otherExpenseAmount?: string;
  note?: string;
  items: PurchaseOrderItemInput[];
}

/**
 * `UpdatePurchaseOrderDto` — `items`, quando presente, substitui a lista.
 * `null` num campo opcional o limpa (o backend distingue ausente de nulo).
 */
export type PurchaseOrderUpdateInput = {
  [K in Exclude<keyof PurchaseOrderInput, 'items'>]?: PurchaseOrderInput[K] | null;
} & { items?: PurchaseOrderItemInput[] };

/** QUANTIDADE | PRECO | AMBOS | NENHUMA — apurado por trigger (bd/11). */
export type DivergenceType = 'QUANTIDADE' | 'PRECO' | 'AMBOS' | 'NENHUMA';

/** Linha conferida (`gestao.recebimento_item`). */
export interface GoodsReceiptItem {
  id: string;
  receiptId: string;
  orderItemId: string | null;
  orderItem: { id: string; sequence: number; description: string } | null;
  productId: string | null;
  product: { id: string; code: string; description: string } | null;
  orderedQuantity: string | null;
  receivedQuantity: string;
  orderedPrice: string | null;
  documentPrice: string | null;
  quantityDivergence: string | null;
  divergenceType: DivergenceType | null;
  accepted: boolean;
  note: string | null;
}

/** Recebimento (`gestao.recebimento`) — append-only no banco. */
export interface GoodsReceipt {
  id: string;
  orderId: string | null;
  order: { id: string; number: string; status: PurchaseOrderStatus; partnerId: string } | null;
  branchId: string | null;
  branch: CodedRef | null;
  fiscalDocumentId: string | null;
  fiscalDocument: {
    id: string;
    number: string;
    series: string | null;
    accessKey: string | null;
  } | null;
  number: string;
  receivedAt: string;
  locationId: string | null;
  location: CodedRef | null;
  inspectorId: string | null;
  inspector: { id: string; name: string } | null;
  hasDivergence: boolean;
  generatedStock: boolean;
  generatedPayable: boolean;
  note: string | null;
  createdAt: string;
  items: GoodsReceiptItem[];
}

export interface GoodsReceiptItemInput {
  orderItemId: string;
  receivedQuantity: string;
  /** Ausente = igual ao preço do pedido. */
  documentPrice?: string;
  /** `false` recusa a linha: fica registrada, mas não abate o pedido. */
  accepted?: boolean;
  locationId?: string;
  batch?: string;
  note?: string;
}

/** Título a pagar da entrega (RF-041). Sem valor: ele é o que chegou. */
export interface GoodsReceiptPayableInput {
  categoryId?: string;
  costCenterId?: string;
  paymentMethodId?: string;
  paymentTermId?: string;
  firstDueDate?: string;
  installmentCount?: number;
  intervalDays?: number;
  documentReference?: string;
  dailyInterestRate?: string;
  penaltyRate?: string;
}

export interface GoodsReceiptInput {
  receivedAt?: string;
  locationId?: string;
  branchId?: string;
  fiscalDocumentId?: string;
  note?: string;
  generatePayable?: boolean;
  payable?: GoodsReceiptPayableInput;
  items: GoodsReceiptItemInput[];
}

/** Linha de `vw_historico_compra` (RF-042). */
export interface PurchaseHistoryLine {
  orderItemId: string;
  orderId: string;
  number: string;
  orderDate: string;
  status: PurchaseOrderStatus;
  partner: { id: string; legalName: string | null };
  product: { id: string; code: string | null } | null;
  description: string;
  quantity: string;
  receivedQuantity: string;
  pendingQuantity: string;
  unitPrice: string;
  lineAmount: string;
  landedUnitCost: string | null;
}

export interface PurchaseHistorySummary {
  lines: number;
  quantity: string;
  amount: string;
  /** Média ponderada pela quantidade — `null` sem quantidade. */
  averagePrice: string | null;
  minPrice: string | null;
  maxPrice: string | null;
  lastOrderDate: string | null;
}

export interface PurchaseHistoryResult extends PaginatedResult<PurchaseHistoryLine> {
  summary: PurchaseHistorySummary;
}

// ---------------------------------------------------------------------------
// Documentos fiscais (RF-043 a RF-050)
// ---------------------------------------------------------------------------

export type FiscalDocumentStatus =
  'RECEBIDO' | 'PROCESSANDO' | 'PROCESSADO' | 'ERRO' | 'DUPLICADO' | 'CANCELADO' | 'DENEGADO';

export type FiscalDocumentModel =
  | 'NFE'
  | 'NFCE'
  | 'NFSE'
  | 'CTE'
  | 'CTE_OS'
  | 'MDFE'
  | 'NFAVULSA'
  | 'RECIBO'
  | 'OUTRO';

export type FiscalDocumentOrigin = 'UPLOAD_MANUAL' | 'COLETA_AUTOMATICA' | 'API' | 'EMAIL' | 'WEBHOOK';

/** Linha da nota com tributos (`documento_fiscal_item`). Valores em string decimal. */
export interface FiscalDocumentItem {
  id: string;
  sequence: number;
  productId: string | null;
  product: { id: string; code: string; description: string; tracksStock: boolean } | null;
  supplierCode: string | null;
  description: string;
  ncm: string | null;
  cest: string | null;
  cfop: string | null;
  unit: string | null;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  freightAmount: string;
  lineAmount: string;
  icmsCst: string | null;
  icmsBase: string;
  icmsRate: string;
  icmsAmount: string;
  icmsStAmount: string;
  ipiAmount: string;
  pisAmount: string;
  cofinsAmount: string;
}

/** Documento completo (`FiscalDocumentRow` — o XML fica fora, pede-se por `/:id/xml`). */
export interface FiscalDocument extends FiscalDocumentSummary {
  model: FiscalDocumentModel;
  branchId: string | null;
  branch: CodedRef | null;
  operationType: string | null;
  operationNature: string | null;
  movedAt: string | null;
  issuerPartnerId: string | null;
  issuerTaxId: string | null;
  issuerPartner: {
    id: string;
    legalName: string;
    tradeName: string | null;
    cnpj: string | null;
    cpf: string | null;
  } | null;
  recipientPartnerId: string | null;
  recipientPartner: { id: string; legalName: string; tradeName: string | null } | null;
  recipientTaxId: string | null;
  recipientName: string | null;
  productsAmount: string;
  discountAmount: string;
  freightAmount: string;
  insuranceAmount: string;
  otherExpenseAmount: string;
  icmsAmount: string;
  icmsStAmount: string;
  ipiAmount: string;
  pisAmount: string;
  cofinsAmount: string;
  issAmount: string;
  origin: FiscalDocumentOrigin;
  originReference: string | null;
  collectedAt: string | null;
  xmlHash: string | null;
  attempts: number;
  processingError: string | null;
  processedAt: string | null;
  duplicateOfId: string | null;
  duplicateOf: {
    id: string;
    number: string;
    accessKey: string | null;
    status: FiscalDocumentStatus;
  } | null;
  purchaseOrder: { id: string; number: string; status: PurchaseOrderStatus; partnerId: string } | null;
  generatedStock: boolean;
  generatedPayable: boolean;
  metadata: Record<string, unknown>;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  items: FiscalDocumentItem[];
}

/** O que aconteceu com um XML entregue à importação (`ImportOutcome`). */
export type FiscalImportOutcome = 'IMPORTADO' | 'JA_IMPORTADO' | 'DUPLICADO' | 'ERRO';

export interface FiscalImportResult {
  outcome: FiscalImportOutcome;
  document: FiscalDocument;
  /** Por que o documento ficou em ERRO ou foi marcado como duplicata. */
  reason?: string;
}

/** Vínculos (`LinkFiscalDocumentDto`): ausente = não mexer; `null` desfaz. */
export interface FiscalDocumentLinkInput {
  issuerPartnerId?: string | null;
  purchaseOrderId?: string | null;
  branchId?: string | null;
  items?: { itemId: string; productId: string | null }[];
}

/** Título a pagar gerado pela nota (`FiscalDocumentPayableDto`). */
export interface FiscalDocumentPayableInput {
  categoryId?: string;
  costCenterId?: string;
  paymentMethodId?: string;
  paymentTermId?: string;
  firstDueDate?: string;
  installmentCount?: number;
  intervalDays?: number;
  note?: string;
}

/** Efeitos pedidos explicitamente (`PostFiscalDocumentDto`). */
export interface FiscalDocumentPostingInput {
  generateStock: boolean;
  generatePayable: boolean;
  locationId?: string;
  payable?: FiscalDocumentPayableInput;
}

export type FiscalAttachmentCategory = 'DANFE' | 'ANEXO';

/** Anexo do documento (`AttachmentResponse`). */
export interface FiscalAttachment {
  id: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  category: string | null;
  createdAt: string;
}

export interface FiscalDocumentSummary {
  id: string;
  model: string;
  accessKey: string | null;
  number: string;
  series: string | null;
  issuedAt: string;
  issuerName: string | null;
  issuerPartner: { id: string; legalName: string; tradeName: string | null } | null;
  totalAmount: string;
  status: FiscalDocumentStatus;
  purchaseOrderId: string | null;
  receipts: { id: string; number: string; receivedAt: string; generatedStock: boolean }[];
  financialEntries: {
    id: string;
    number: string;
    type: EntryType;
    netAmount: string;
    status: EntryStatus;
  }[];
}

// ---------------------------------------------------------------------------
// Bancos (RF-059 a RF-071 — UI-042 a UI-047)
// ---------------------------------------------------------------------------

export type CompanyAccountType = 'CORRENTE' | 'POUPANCA' | 'PAGAMENTO';

/** Conta bancária da empresa (`gestao.conta_bancaria`) — de onde o dinheiro sai. */
export interface CompanyBankAccount {
  id: string;
  description: string;
  bankCode: string;
  bankName: string | null;
  agency: string;
  agencyDigit: string | null;
  account: string;
  accountDigit: string | null;
  accountType: CompanyAccountType;
  pixKey: string | null;
  branchId: string | null;
  providerId: string | null;
  credentialId: string | null;
  openingBalance: string;
  /** Saldo informado pelo banco no último extrato — nunca digitado (RF-060). */
  currentBalance: string;
  balanceDate: string | null;
  allowsPayment: boolean;
  allowsReceipt: boolean;
  isDefault: boolean;
  isActive: boolean;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CompanyBankAccountInput {
  description: string;
  bankCode: string;
  bankName?: string;
  agency: string;
  agencyDigit?: string;
  account: string;
  accountDigit?: string;
  accountType?: CompanyAccountType;
  pixKey?: string;
  branchId?: string;
  providerId?: string;
  credentialId?: string;
  openingBalance?: string;
  allowsPayment?: boolean;
  allowsReceipt?: boolean;
  isDefault?: boolean;
  note?: string;
}

/** Banco, agência e conta são a identidade da conta: não se alteram. */
export type CompanyBankAccountUpdateInput = Partial<
  Omit<CompanyBankAccountInput, 'bankCode' | 'agency' | 'account'>
> & { isActive?: boolean };

/** O que o provedor sabe fazer (`provider.capacidades`). */
export interface ProviderCapabilities {
  pix?: boolean;
  boleto?: boolean;
  ted?: boolean;
  doc?: boolean;
  transferencia_interna?: boolean;
  cancelamento?: boolean;
  webhook?: boolean;
  consulta?: boolean;
}

export interface BankProvider {
  id: string;
  code: string;
  name: string;
  category: string;
  capabilities: ProviderCapabilities;
}

/** Credencial sem o segredo — nenhuma rota o devolve (RNF-003). */
export interface IntegrationCredential {
  id: string;
  name: string;
  environment: string;
  isActive: boolean;
  provider: BankProvider;
}

export type TransactionDirection = 'DEBITO' | 'CREDITO';

export type PaymentTransactionStatus =
  | 'CRIADA'
  | 'AGENDADA'
  | 'ENFILEIRADA'
  | 'ENVIADA'
  | 'PROCESSANDO'
  | 'CONFIRMADA'
  | 'FALHA'
  | 'CANCELADA'
  | 'ESTORNADA'
  | 'EXPIRADA';

/** Ordem de pagamento ou recebimento (`DETAIL_FIELDS` do backend). */
export interface PaymentTransaction {
  id: string;
  companyId: string;
  bankAccountId: string;
  providerId: string;
  installmentId: string | null;
  direction: TransactionDirection;
  method: PaymentMethodType;
  status: PaymentTransactionStatus;
  amount: string;
  description: string | null;
  scheduledFor: string | null;
  executedAt: string | null;
  confirmedAt: string | null;
  payeeName: string | null;
  payeeDocument: string | null;
  payeeBankCode: string | null;
  payeeAgency: string | null;
  payeeAccount: string | null;
  pixKey: string | null;
  barcode: string | null;
  idempotencyKey: string;
  /** Identificador da operação no provedor (RF-068). */
  externalId: string | null;
  endToEndId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  attempts: number;
  maxAttempts: number;
  /** O provedor aceita cancelar depois do envio (RF-065). */
  cancellable: boolean;
  cancelledAt: string | null;
  cancellationReason: string | null;
  createdAt: string;
  updatedAt: string;
  /** Só no detalhe. */
  bankAccount?: { id: string; description: string; bankCode: string; account: string };
  settlements?: { id: string; settlementDate: string; totalAmount: string }[];
}

export interface PaymentInput {
  bankAccountId: string;
  direction?: TransactionDirection;
  method: PaymentMethodType;
  amount: string;
  description?: string;
  scheduledFor?: string;
  installmentId?: string;
  payeeName?: string;
  payeeDocument?: string;
  payeeBankCode?: string;
  payeeAgency?: string;
  payeeAccount?: string;
  pixKey?: string;
  barcode?: string;
}

export interface ConfirmPaymentInput {
  externalId?: string;
  confirmedAt?: string;
  note?: string;
}

export type StatementFormat = 'OFX' | 'CSV' | 'CNAB240';

export interface BankStatementImport {
  id: string;
  bankAccountId: string;
  format: StatementFormat;
  fileName: string | null;
  fileHash: string;
  periodStart: string | null;
  periodEnd: string | null;
  openingBalance: string | null;
  closingBalance: string | null;
  totalCount: number;
  importedCount: number;
  duplicateCount: number;
  status: string;
  error: string | null;
  createdAt: string;
}

export type ReconciliationStatus =
  | 'NAO_CONCILIADO'
  | 'SUGERIDO'
  | 'CONCILIADO'
  | 'DIVERGENTE'
  | 'IGNORADO';

export interface BankTransaction {
  id: string;
  bankAccountId: string;
  statementImportId: string | null;
  movementDate: string;
  postedDate: string | null;
  direction: TransactionDirection;
  amount: string;
  balanceAfter: string | null;
  description: string | null;
  document: string | null;
  externalId: string | null;
  counterpartName: string | null;
  counterpartDocument: string | null;
  reconciliationStatus: ReconciliationStatus;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Conciliação bancária (RF-071 a RF-077)
// ---------------------------------------------------------------------------

/** Natureza reconhecida no histórico do extrato (`BankTransactionKind`). */
export type BankTransactionKind =
  | 'PIX'
  | 'TED'
  | 'DOC'
  | 'BOLETO'
  | 'TARIFA'
  | 'RENDIMENTO'
  | 'IMPOSTO'
  | 'ESTORNO'
  | 'TRANSFERENCIA_INTERNA'
  | 'OUTRO';

/** Identificação gravada em `metadados.identification` (RF-072). */
export interface BankTransactionIdentification {
  kind: BankTransactionKind;
  document?: string;
  reference?: string;
  counterpartName?: string;
  partnerId?: string;
  partnerName?: string;
  internalAccountId?: string;
  identifiedAt: string;
}

/** Nota da última decisão sobre o movimento (ignorar/reabrir). */
export interface BankTransactionDecisionNote {
  ignoredBy?: string;
  ignoredAt?: string;
  reason?: string;
  reopenedBy?: string;
  reopenedAt?: string;
}

export interface BankTransactionMetadata {
  identification?: BankTransactionIdentification;
  reconciliation?: BankTransactionDecisionNote;
  [chave: string]: unknown;
}

/** Linha de `GET /reconciliation/pending`. */
export interface PendingBankTransaction {
  id: string;
  bankAccountId: string;
  movementDate: string;
  direction: TransactionDirection;
  amount: string;
  description: string | null;
  document: string | null;
  counterpartName: string | null;
  reconciliationStatus: ReconciliationStatus;
  metadata: BankTransactionMetadata | null;
}

/** Resposta de `POST /reconciliation/bank-transactions/:id/ignore|reopen`. */
export interface ReconciliationMovement {
  id: string;
  bankAccountId: string;
  movementDate: string;
  direction: TransactionDirection;
  amount: string;
  description: string | null;
  reconciliationStatus: ReconciliationStatus;
  metadata: BankTransactionMetadata | null;
}

/** Parcela candidata, com score e motivos (`MatchCandidate`). */
export interface MatchCandidate {
  installmentId: string;
  entryId: string;
  entryNumber: string;
  entryType: EntryType;
  partnerId: string | null;
  partnerName: string | null;
  description: string;
  installmentNumber: number;
  totalInstallments: number;
  dueDate: string;
  balance: string;
  /** Dias entre o vencimento e o movimento. Negativo = antecipado. */
  dayGap: number;
  /** Movimento (restante) menos saldo da parcela. */
  difference: string;
  /** Decimal de 0 a 100. */
  score: string;
  reasons: string[];
}

/** Resposta de `GET /reconciliation/bank-transactions/:id/suggestions`. */
export interface ReconciliationSuggestions {
  bankTransactionId: string;
  movementDate: string;
  direction: TransactionDirection;
  amount: string;
  reconciliationStatus: ReconciliationStatus;
  identification: Omit<BankTransactionIdentification, 'identifiedAt'> & { identifiedAt?: string };
  candidates: MatchCandidate[];
}

export type ReconciliationOrigin =
  | 'MANUAL'
  | 'AUTOMATICA_REGRA'
  | 'AUTOMATICA_EXATA'
  | 'IMPORTACAO';

export interface Reconciliation {
  id: string;
  bankTransactionId: string;
  installmentId: string | null;
  settlementId: string | null;
  paymentTransactionId: string | null;
  ruleId: string | null;
  origin: ReconciliationOrigin;
  score: string | null;
  reconciledAmount: string;
  difference: string;
  hasDivergence: boolean;
  justification: string | null;
  confirmed: boolean;
  confirmedById: string | null;
  confirmedAt: string | null;
  undoneAt: string | null;
  undoneById: string | null;
  undoReason: string | null;
  createdAt: string;
}

/** Linha do histórico (`GET /reconciliation`), com o movimento resumido. */
export interface ReconciliationListItem extends Reconciliation {
  bankTransaction: {
    bankAccountId: string;
    movementDate: string;
    direction: TransactionDirection;
    amount: string;
    description: string | null;
    reconciliationStatus: ReconciliationStatus;
  };
}

/** Corpo de `POST /reconciliation` — ao menos um alvo. */
export interface ReconciliationInput {
  bankTransactionId: string;
  installmentId?: string;
  settlementId?: string;
  paymentTransactionId?: string;
  amount: string;
  justification?: string;
}

/** Resposta de `POST /reconciliation/run`. */
export interface AutoReconciliationJob {
  jobId: string;
  bankAccountId: string;
  from: string;
  to: string;
  status: string;
}

export interface ReconciliationRuleConditions {
  direction?: TransactionDirection;
  descriptionContains?: string;
  documentEquals?: string;
  counterpartDocument?: string;
  minAmount?: string;
  maxAmount?: string;
  bankAccountId?: string;
}

export interface ReconciliationRuleActions {
  autoReconcile?: boolean;
  minScore?: string;
  markIgnored?: boolean;
}

export interface ReconciliationRule {
  id: string;
  name: string;
  priority: number;
  conditions: ReconciliationRuleConditions;
  actions: ReconciliationRuleActions;
  valueTolerance: string;
  dayTolerance: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ReconciliationRuleInput {
  name: string;
  priority: number;
  conditions: ReconciliationRuleConditions;
  actions: ReconciliationRuleActions;
  valueTolerance: string;
  dayTolerance: number;
  isActive: boolean;
}

/** Movimento da amostra do painel de divergências. */
export interface DivergenceMovement {
  id: string;
  bankAccountId: string;
  movementDate: string;
  direction: TransactionDirection;
  amount: string;
  description: string | null;
  reconciliationStatus: ReconciliationStatus;
}

export interface DivergenceMovementSummary {
  count: number;
  debitTotal: string;
  creditTotal: string;
  sample: DivergenceMovement[];
}

export interface DivergentLink extends Reconciliation {
  bankTransaction: {
    movementDate: string;
    direction: TransactionDirection;
    amount: string;
    description: string | null;
  };
}

export interface SettlementWithoutMovement {
  id: string;
  settlementDate: string;
  totalAmount: string;
  bankAccountId: string | null;
  installmentId: string;
  transactionId: string | null;
}

export interface DivergenceAccount {
  id: string;
  description: string;
  bankCode: string;
  agency: string;
  account: string;
  currentBalance: string;
  balanceDate: string | null;
  pendingCount: number;
  pendingAmount: string;
}

/** Resposta de `GET /reconciliation/divergences` (RF-076). */
export interface ReconciliationDivergences {
  period: { from: string | null; to: string | null };
  bankAccountId: string | null;
  unreconciled: DivergenceMovementSummary;
  partiallyReconciled: DivergenceMovementSummary;
  divergentLinks: { count: number; sample: DivergentLink[] };
  settlementsWithoutMovement: { count: number; sample: SettlementWithoutMovement[] };
  accounts: DivergenceAccount[];
}

// ---------------------------------------------------------------------------
// Fila e reprocessamento (RF-069/RF-070, RF-128/RF-130)
// ---------------------------------------------------------------------------

export type JobStatus = 'PENDENTE' | 'PROCESSANDO' | 'CONCLUIDO' | 'FALHA' | 'CANCELADO' | 'AGENDADO';

/** Contagem por situação dos últimos 7 dias. */
export interface QueueSummary {
  window: string;
  byStatus: Record<string, number>;
  pending: number;
  failed: number;
}

export interface IntegrationHealth {
  /** Uma linha por integração da empresa, das piores para as saudáveis. */
  integrations: IntegrationHealthRow[];
  totals: { total: number; active: number; suspended: number; degraded: number; errors24h: number };
  queue: QueueSummary;
  webhooks: QueueSummary;
}

export interface FailedJob {
  id: string;
  queue: string;
  name: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  error: string | null;
  lastErrorAt: string | null;
  createdAt: string;
  finishedAt: string | null;
  correlationId: string | null;
}

export interface FailedWebhook {
  id: string;
  providerId: string | null;
  eventType: string;
  externalId: string | null;
  signatureValid: boolean | null;
  status: string;
  attempts: number;
  error: string | null;
  receivedAt: string;
  processedAt: string | null;
}

export type ReprocessTarget = 'JOB' | 'WEBHOOK';

export interface ReprocessResult {
  target: ReprocessTarget;
  sourceId: string;
  /** `null` quando já havia um reprocessamento pendente para o mesmo alvo. */
  jobId: string | null;
  queue: string;
}

// ---------------------------------------------------------------------------
// Contabilidade — M11 (RF-078 a RF-087 — UI-054 a UI-060)
// ---------------------------------------------------------------------------

export type LedgerAccountType =
  | 'ATIVO'
  | 'PASSIVO'
  | 'PATRIMONIO_LIQUIDO'
  | 'RECEITA'
  | 'DESPESA'
  | 'CUSTO'
  | 'COMPENSACAO';

export type AccountNature = 'DEVEDORA' | 'CREDORA';

/** Conta do plano de contas (`accountSelect` do backend). */
export interface LedgerAccount {
  id: string;
  parentId: string | null;
  code: string;
  shortCode: string | null;
  name: string;
  type: LedgerAccountType;
  nature: AccountNature;
  level: number;
  /** Analítica: recebe partida. Sintética (com filhas) não recebe. */
  acceptsEntry: boolean;
  spedReferenceCode: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LedgerAccountNode extends LedgerAccount {
  children: LedgerAccountNode[];
}

/** `CreateLedgerAccountDto`. A natureza só é informada em compensação (RF-079). */
export interface LedgerAccountInput {
  code: string;
  shortCode?: string;
  name: string;
  type: LedgerAccountType;
  nature?: AccountNature;
  parentId?: string;
  acceptsEntry?: boolean;
  spedReferenceCode?: string;
}

/** `UpdateLedgerAccountDto`: código e tipo ficam de fora de propósito. */
export interface LedgerAccountUpdate {
  name?: string;
  shortCode?: string;
  spedReferenceCode?: string;
  acceptsEntry?: boolean;
  isActive?: boolean;
}

export type ClassifiableSource = 'categories' | 'payroll-items' | 'bank-accounts';

/** Uma origem financeira e a conta contábil dela (RF-080). */
export interface AccountClassification {
  id: string;
  code: string;
  name: string;
  ledgerAccountId: string | null;
  ledgerAccountCode: string | null;
  ledgerAccountName: string | null;
}

export type JournalLineType = 'DEBITO' | 'CREDITO';

export interface JournalEntryLine {
  id: string;
  sequence: number;
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: LedgerAccountType;
  type: JournalLineType;
  /** Decimal textual — nunca `number` (RN-012). */
  amount: string;
  costCenterId: string | null;
  extraHistory: string | null;
}

export interface JournalEntry {
  id: string;
  number: number;
  branchId: string | null;
  periodId: string | null;
  entryDate: string;
  competenceDate: string;
  history: string;
  totalAmount: string;
  /** MANUAL, TITULO_BAIXA, DOCUMENTO_FISCAL, ESTOQUE, ESTORNO. */
  origin: string | null;
  originId: string | null;
  settlementId: string | null;
  fiscalDocumentId: string | null;
  batch: string | null;
  reversalOfId: string | null;
  isReversed: boolean;
  exported: boolean;
  exportedAt: string | null;
  createdAt: string;
  lines: JournalEntryLine[];
}

export interface JournalEntryLineInput {
  accountId: string;
  type: JournalLineType;
  amount: string;
  costCenterId?: string;
  extraHistory?: string;
}

/** `CreateJournalEntryDto`. Não existe alteração: corrigir é estornar (RF-082). */
export interface JournalEntryInput {
  entryDate: string;
  competenceDate?: string;
  history: string;
  lines: JournalEntryLineInput[];
  branchId?: string;
  batch?: string;
}

export type AccountingPeriodStatus = 'ABERTO' | 'EM_FECHAMENTO' | 'FECHADO' | 'REABERTO';

export interface AccountingPeriod {
  id: string;
  year: number;
  month: number;
  startDate: string;
  endDate: string;
  status: AccountingPeriodStatus;
  closedAt: string | null;
  closedById: string | null;
  reopenedAt: string | null;
  reopenedById: string | null;
  reopenReason: string | null;
}

export interface ReportRange {
  from: string;
  to: string;
}

export interface LedgerReportRow {
  entryId: string;
  entryNumber: number;
  competenceDate: string;
  history: string;
  extraHistory: string | null;
  origin: string | null;
  debit: string;
  credit: string;
  balance: string;
}

export interface LedgerReport {
  account: Pick<LedgerAccount, 'id' | 'code' | 'name' | 'type' | 'nature'>;
  range: ReportRange;
  costCenterId: string | null;
  openingBalance: string;
  totalDebit: string;
  totalCredit: string;
  closingBalance: string;
  rows: LedgerReportRow[];
}

export interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  type: LedgerAccountType;
  nature: AccountNature;
  openingBalance: string;
  debit: string;
  credit: string;
  closingBalance: string;
}

export interface TrialBalance {
  range: ReportRange;
  costCenterId: string | null;
  totalDebit: string;
  totalCredit: string;
  balanced: boolean;
  rows: TrialBalanceRow[];
}

export interface IncomeStatementLine {
  accountId: string;
  code: string;
  name: string;
  type: LedgerAccountType;
  amount: string;
}

export interface IncomeStatementGroup {
  total: string;
  lines: IncomeStatementLine[];
}

export interface IncomeStatement {
  range: ReportRange;
  revenue: IncomeStatementGroup;
  cost: IncomeStatementGroup;
  expense: IncomeStatementGroup;
  grossResult: string;
  netResult: string;
}

export type AccountingExportFormat = 'csv' | 'json';

/** `ExportAccountingDto`. */
export interface AccountingExportInput {
  from: string;
  to: string;
  format?: AccountingExportFormat;
  markExported?: boolean;
  pendingOnly?: boolean;
}

/** O arquivo gerado e a contagem que o servidor põe nos cabeçalhos. */
export interface AccountingExportFile {
  content: Blob;
  filename: string;
  entries: number | null;
  lines: number | null;
}

// ---------------------------------------------------------------------------
// M16 — Fiscal e tributação (RF-088 a RF-094 — UI-061 a UI-064)
// ---------------------------------------------------------------------------

/**
 * Parâmetro fiscal vigente (RF-088).
 *
 * As alíquotas são **string decimal** (RN-012): entram na apuração, e `number`
 * em JSON é ponto flutuante binário. `branchId` nulo = a empresa inteira.
 */
export interface TaxParameter {
  id: string;
  branchId: string | null;
  taxRegime: TaxRegime;
  effectiveFrom: string;
  effectiveTo: string | null;
  simplesRate: string | null;
  issRate: string | null;
  ipiTaxpayer: boolean;
  taxSubstitute: boolean;
  additionalParameters: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

/** `CreateTaxParameterDto`. */
export interface TaxParameterInput {
  branchId?: string;
  taxRegime: TaxRegime;
  effectiveFrom: string;
  effectiveTo?: string;
  simplesRate?: string;
  issRate?: string;
  ipiTaxpayer?: boolean;
  taxSubstitute?: boolean;
}

/** `UpdateTaxParameterDto` — sem `branchId`: mudar de filial move o regime. */
export interface TaxParameterUpdate {
  taxRegime?: TaxRegime;
  effectiveFrom?: string;
  effectiveTo?: string | null;
  simplesRate?: string | null;
  issRate?: string | null;
  ipiTaxpayer?: boolean;
  taxSubstitute?: boolean;
}

export type TaxClassificationType = 'NCM' | 'CEST' | 'CFOP' | 'CST' | 'LC116';

/** Classificação fiscal do cadastro da empresa (RF-089). */
export interface TaxClassification {
  id: string;
  type: TaxClassificationType;
  code: string;
  description: string;
  icmsRate: string | null;
  ipiRate: string | null;
  pisRate: string | null;
  cofinsRate: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** `CreateTaxClassificationDto`. */
export interface TaxClassificationInput {
  type: TaxClassificationType;
  code: string;
  description: string;
  icmsRate?: string;
  ipiRate?: string;
  pisRate?: string;
  cofinsRate?: string;
}

/** `UpdateTaxClassificationDto` — `type` e `code` são a identidade da linha. */
export interface TaxClassificationUpdate {
  description?: string;
  icmsRate?: string | null;
  ipiRate?: string | null;
  pisRate?: string | null;
  cofinsRate?: string | null;
  isActive?: boolean;
}

export type TaxOperationType = 'COMPRA' | 'VENDA' | 'TRANSFERENCIA' | 'DEVOLUCAO';

/** Regra fiscal aplicada a operações e produtos (RF-091). */
export interface TaxRule {
  id: string;
  name: string;
  priority: number;
  originState: string | null;
  destinationState: string | null;
  operationType: TaxOperationType | null;
  classificationId: string | null;
  productId: string | null;
  productCategoryId: string | null;
  cfop: string | null;
  icmsCst: string | null;
  icmsRate: string | null;
  icmsBaseReduction: string | null;
  conditions: Record<string, unknown> | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** `CreateTaxRuleDto`. Pelo menos um critério é obrigatório (bd/18 §5). */
export interface TaxRuleInput {
  name: string;
  priority?: number;
  originState?: string;
  destinationState?: string;
  operationType?: TaxOperationType;
  classificationId?: string;
  productId?: string;
  productCategoryId?: string;
  cfop?: string;
  icmsCst?: string;
  icmsRate?: string;
  icmsBaseReduction?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
}

/** `UpdateTaxRuleDto` — critério apagado vai como `null`. */
export type TaxRuleUpdate = {
  [K in keyof TaxRuleInput]?: TaxRuleInput[K] | null;
} & { isActive?: boolean };

/** `ResolveTaxRuleDto` — simulação: nada é gravado. */
export interface TaxRuleResolveQuery {
  operationType?: TaxOperationType;
  originState?: string;
  destinationState?: string;
  productId?: string;
  productCategoryId?: string;
  classificationId?: string;
  onDate?: string;
}

/**
 * Resolução da regra (RF-091): a que decide e as demais candidatas, já
 * ordenadas por prioridade e especificidade.
 */
export interface TaxRuleResolution {
  matched: TaxRule | null;
  alternatives: TaxRule[];
}

/** Divergência entre o declarado no XML e o esperado pelo cadastro (RF-090). */
export interface TaxDivergence {
  sequence: number;
  field: string;
  declared: string;
  expected: string;
  note: string;
}

export interface DocumentTaxItem {
  id: string;
  sequence: number;
  description: string;
  ncm: string | null;
  cest: string | null;
  cfop: string | null;
  quantity: string;
  unitPrice: string;
  lineAmount: string;
  icmsCst: string | null;
  icmsBase: string;
  icmsRate: string;
  icmsAmount: string;
  icmsStAmount: string;
  ipiAmount: string;
  pisAmount: string;
  cofinsAmount: string;
  classificationId: string | null;
  classification: {
    id: string;
    code: string;
    description: string;
    icmsRate: string | null;
    ipiRate: string | null;
  } | null;
}

/**
 * Tributação declarada da nota (RF-090).
 *
 * Nada aqui é recalculado: `declared` é o que o emitente informou e `itemTotals`
 * é a soma das linhas, exibida só para conferência.
 */
export interface DocumentTaxSummary {
  documentId: string;
  number: string;
  series: string | null;
  accessKey: string | null;
  issuedAt: string;
  status: string;
  declared: {
    productsAmount: string;
    totalAmount: string;
    icmsAmount: string;
    icmsStAmount: string;
    ipiAmount: string;
    pisAmount: string;
    cofinsAmount: string;
    issAmount: string;
  };
  itemTotals: {
    lineAmount: string;
    icmsAmount: string;
    icmsStAmount: string;
    ipiAmount: string;
    pisAmount: string;
    cofinsAmount: string;
  };
  items: DocumentTaxItem[];
  divergences: TaxDivergence[];
  unclassifiedItems: number;
}

/** Resultado da classificação automática por NCM (RF-090). */
export interface AutoClassifyResult {
  classified: number;
  /** NCMs da nota que não existem no cadastro — não classificados. */
  pending: string[];
}

export type FiscalEventType = 'CANCELAMENTO' | 'CCE' | 'MANIFESTACAO' | 'INUTILIZACAO';
export type FiscalEventStatus = 'REGISTRADO' | 'TRANSMITIDO' | 'AUTORIZADO' | 'REJEITADO';

/** Evento transmitido ao fisco (RF-092/RF-094). */
export interface FiscalEvent {
  id: string;
  documentId: string | null;
  type: FiscalEventType;
  protocol: string | null;
  sequence: number;
  occurredAt: string;
  justification: string | null;
  status: FiscalEventStatus;
  response: Record<string, unknown> | null;
  createdAt: string;
}

/** `CreateFiscalEventDto`. O evento nasce REGISTRADO. */
export interface FiscalEventInput {
  type: FiscalEventType;
  documentId?: string;
  sequence?: number;
  justification?: string;
}

/** `SettleFiscalEventDto` — retorno do fisco lançado a mão. */
export interface FiscalEventSettlement {
  status: 'AUTORIZADO' | 'REJEITADO';
  protocol: string;
  message?: string;
}

export type FiscalDirection = 'ENTRADA' | 'SAIDA';

export interface FiscalReportPeriod {
  from: string;
  to: string;
}

/** Linha da apuração fiscal por competência (RF-093). */
export interface FiscalAssessmentRow {
  competence: string;
  direction: string;
  model: string;
  documents: number;
  totalAmount: string;
  productsAmount: string;
  icmsAmount: string;
  icmsStAmount: string;
  ipiAmount: string;
  pisAmount: string;
  cofinsAmount: string;
  issAmount: string;
}

export interface FiscalAssessmentTotal {
  documents: number;
  totalAmount: string;
  icmsAmount: string;
  icmsStAmount: string;
  ipiAmount: string;
  pisAmount: string;
  cofinsAmount: string;
  issAmount: string;
}

/**
 * Apuração fiscal (RF-093). Os totais vêm separados por sentido: imposto de
 * entrada é crédito e o de saída é débito — somá-los não apura nada.
 */
export interface FiscalAssessmentReport {
  period: FiscalReportPeriod;
  rows: FiscalAssessmentRow[];
  totals: Record<string, FiscalAssessmentTotal>;
}

/** Linha do livro de entradas e saídas por CFOP e NCM (RF-093). */
export interface FiscalLedgerRow {
  competence: string;
  direction: string;
  cfop: string | null;
  ncm: string | null;
  items: number;
  totalAmount: string;
  icmsBase: string;
  icmsAmount: string;
  icmsStAmount: string;
  ipiAmount: string;
  pisAmount: string;
  cofinsAmount: string;
}

export interface FiscalLedgerReport {
  period: FiscalReportPeriod;
  rows: FiscalLedgerRow[];
}

// ---------------------------------------------------------------------------
// M17 — Notificações e automação (RF-119 a RF-125 — UI-065 a UI-067)
// ---------------------------------------------------------------------------

export type NotificationChannel = 'INTERNO' | 'EMAIL';
export type NotificationStatus = 'PENDENTE' | 'ENVIADA' | 'LIDA' | 'FALHA' | 'CANCELADA';

/**
 * Aviso da caixa de entrada (RF-119).
 *
 * O backend nunca devolve endereço, chave de dedupe nem tentativas de entrega:
 * é mecanismo de entrega, não aviso (RNF-005).
 */
export interface AppNotification {
  id: string;
  userId: string | null;
  channel: NotificationChannel;
  type: string;
  title: string;
  message: string;
  /** 1 = mais urgente, 5 = informativo. */
  priority: number;
  entity: string | null;
  entityId: string | null;
  link: string | null;
  status: NotificationStatus;
  sentAt: string | null;
  readAt: string | null;
  createdAt: string;
}

export type AutomationTrigger =
  | 'TITULO_VENCENDO'
  | 'PAGAMENTO_PROCESSADO'
  | 'PAGAMENTO_FALHOU'
  | 'APROVACAO_PENDENTE'
  | 'DIVERGENCIA_CONCILIACAO';

/** `AutomationConditionsDto` — forma fechada: o motor só entende estas chaves. */
export interface AutomationConditions {
  daysAhead?: number;
  minAmount?: string;
  entryType?: EntryType;
  includeOverdue?: boolean;
}

/** `AutomationActionDto`. A única ação possível é notificar. */
export interface AutomationAction {
  type: 'NOTIFICAR';
  channel: NotificationChannel;
  /** Endereçamento por permissão, no formato `recurso:AÇÃO`. */
  permission?: string;
  userIds?: string[];
  priority?: number;
}

/** Regra de automação de avisos (RF-125). */
export interface AutomationRule {
  id: string;
  name: string;
  description: string | null;
  triggerEvent: AutomationTrigger;
  conditions: AutomationConditions | null;
  actions: AutomationAction[];
  isActive: boolean;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** `CreateAutomationRuleDto`. */
export interface AutomationRuleInput {
  name: string;
  description?: string;
  triggerEvent: AutomationTrigger;
  conditions?: AutomationConditions;
  actions: AutomationAction[];
  isActive?: boolean;
}

export type AutomationRuleUpdate = Partial<AutomationRuleInput>;

/** Execução registrada da regra (RF-125). */
export interface AutomationRuleRun {
  id: string;
  status: string;
  result: Record<string, unknown> | null;
  error: string | null;
  executedAt: string;
}

// ---------------------------------------------------------------------------
// M15 — Relatórios e dashboards (RF-106 a RF-113 — UI-068 a UI-073)
// ---------------------------------------------------------------------------

/**
 * Recorte comum a todo painel e relatório do M15 (`ReportFilterDto` — RF-112).
 *
 * O período é obrigatório e **não tem padrão no servidor**: um painel que
 * assume "os últimos 30 dias" produz um número que ninguém pediu e que muda
 * sozinho de um dia para o outro. A empresa não entra aqui — vem do cabeçalho
 * e é validada pelo guard; aceitá-la no filtro seria a rota do IDOR.
 */
export interface ReportFilter {
  from: string;
  to: string;
  branchId?: string;
  categoryId?: string;
  costCenterId?: string;
  bankAccountId?: string;
  partnerId?: string;
}

export interface ReportPeriod {
  from: string;
  to: string;
}

/** Realizado agrupado por competência (RF-106). */
export interface FinancialMonth {
  competence: string;
  inflow: string;
  outflow: string;
  net: string;
}

/** Dashboard financeiro (RF-106). */
export interface FinancialDashboard {
  period: ReportPeriod;
  openPortfolio: {
    receivable: string;
    payable: string;
    overdueReceivable: string;
    overduePayable: string;
    installments: number;
  };
  realized: {
    inflow: string;
    outflow: string;
    net: string;
    settlements: number;
    interest: string;
    discount: string;
  };
  byMonth: FinancialMonth[];
}

/** Faixa de atraso de `vw_carteira_titulo`. */
export type AgingBand = 'A_VENCER' | 'ATE_30' | 'DE_31_A_60' | 'DE_61_A_90' | 'ACIMA_DE_90';

export interface PortfolioDueRow {
  type: EntryType;
  agingBand: AgingBand;
  competence: string;
  installments: number;
  balance: string;
  charges: string;
  updatedAmount: string;
}

export interface PortfolioAgingRow {
  band: AgingBand;
  installments: number;
  receivable: string;
  payable: string;
}

/** Contas a pagar e a receber com aging (RF-107). */
export interface PortfolioDashboard {
  period: ReportPeriod;
  dueInPeriod: PortfolioDueRow[];
  /** Sobre a carteira inteira, não só sobre a janela filtrada. */
  aging: PortfolioAgingRow[];
  totals: { receivable: string; payable: string };
}

export interface CashDay {
  date: string;
  status: string;
  inflow: string;
  outflow: string;
  movements: number;
}

export interface IncomeLine {
  competence: string;
  type: string;
  accountCode: string;
  accountName: string;
  amount: string;
}

/** Fluxo de caixa realizado e resultado do período (RF-108). */
export interface CashFlowDashboard {
  period: ReportPeriod;
  cash: {
    days: CashDay[];
    /** Somas por situação do movimento (REALIZADO, PREVISTO, …). */
    totals: Record<string, { inflow: string; outflow: string }>;
  };
  result: {
    lines: IncomeLine[];
    revenue: string;
    expense: string;
    net: string;
  };
}

export interface PurchaseOrderIndicator {
  competence: string;
  status: string;
  orders: number;
  productsAmount: string;
  freightAmount: string;
  totalAmount: string;
}

export interface SupplierIndicator {
  partnerId: string;
  partnerName: string;
  orders: number;
  totalAmount: string;
  receipts: number;
  divergentReceipts: number;
  averageLeadTimeDays: string | null;
  worstDeliveryDelayDays: number | null;
}

export interface StockIndicator {
  locationId: string;
  locationName: string;
  productCategoryId: string | null;
  items: number;
  quantity: string;
  totalAmount: string;
  itemsBelowMinimum: number;
}

/** Compras, fornecedores e estoque (RF-109). O estoque é posição, não período. */
export interface PurchasingDashboard {
  period: ReportPeriod;
  orders: PurchaseOrderIndicator[];
  suppliers: SupplierIndicator[];
  stock: StockIndicator[];
  totals: { purchased: string; stockValue: string; itemsBelowMinimum: number };
}

export interface HeadcountRow {
  departmentId: string | null;
  departmentName: string | null;
  positionId: string | null;
  costCenterId: string | null;
  status: string;
  employees: number;
  employeesWithSalary: number;
  baseSalaryTotal: string;
}

export interface WorkforceMovementRow {
  competence: string;
  departmentId: string | null;
  hires: number;
  terminations: number;
}

export interface CostCenterRow {
  competence: string;
  costCenterId: string;
  costCenterName: string;
  type: string;
  budgetedAmount: string;
  realizedAmount: string;
}

/** Funcionários e centros de custo (RF-110). O quadro é posição de hoje. */
export interface WorkforceDashboard {
  period: ReportPeriod;
  headcount: HeadcountRow[];
  movement: WorkforceMovementRow[];
  costCenters: CostCenterRow[];
  totals: {
    activeEmployees: number;
    activeBaseSalary: string;
    hires: number;
    terminations: number;
  };
}

/**
 * Balancete e DRE do período (RF-111).
 *
 * Nada é recalculado pelo M15: as duas peças vêm do M11, para que não existam
 * duas definições de "resultado do mês" no sistema.
 */
export interface AccountingStatementReport {
  period: ReportPeriod;
  trialBalance: TrialBalance;
  incomeStatement: IncomeStatement;
}

/** Apuração e livro fiscal do período (RF-111), calculados pelo M12. */
export interface FiscalStatementReport {
  period: ReportPeriod;
  assessment: FiscalAssessmentReport;
  ledger: FiscalLedgerReport;
}

/**
 * Catálogo fechado de relatórios exportáveis (`REPORT_KEYS` — RF-111/RF-113).
 *
 * Fechado de propósito: receber o nome da view ou a consulta no corpo faria da
 * rota de exportação um executor de SQL arbitrário com o crachá de quem chamou.
 */
export type ReportKey =
  | 'financeiro'
  | 'carteira'
  | 'fluxo-caixa'
  | 'compras-estoque'
  | 'pessoal'
  | 'contabil'
  | 'fiscal';

export type ReportFormat = 'csv' | 'xlsx' | 'pdf';

/** `ExportReportDto` (RF-113). */
export interface ReportExportInput extends ReportFilter {
  report: ReportKey;
  format: ReportFormat;
}

/** O arquivo gerado; o nome vem do servidor, nunca do cliente. */
export interface ReportExportFile {
  content: Blob;
  filename: string;
}

// ---------------------------------------------------------------------------
// M18 — Administração de integrações (RF-126 a RF-130 — UI-074/UI-075)
// ---------------------------------------------------------------------------

export type IntegrationEnvironment = 'PRODUCAO' | 'HOMOLOGACAO' | 'SANDBOX';
export type IntegrationStatus = 'ATIVA' | 'SUSPENSA' | 'ERRO' | 'INATIVA';

/**
 * Integração externa da empresa (RF-126/RF-127).
 *
 * `parameters` nunca carrega segredo: chave com nome de credencial é recusada
 * pela API e pelo banco (bd/20 §3). O segredo mora na credencial cifrada, que
 * aparece aqui só por id e nome — nenhuma rota devolve o valor (RNF-003).
 */
export interface Integration {
  id: string;
  code: string;
  name: string;
  environment: IntegrationEnvironment;
  parameters: Record<string, unknown> | null;
  status: IntegrationStatus;
  isActive: boolean;
  timeoutMs: number;
  maxAttempts: number;
  failureStreak: number;
  failureThreshold: number;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  suspensionReason: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  provider: BankProvider;
  credential: {
    id: string;
    name: string;
    environment: string;
    expiresAt: string | null;
  } | null;
}

/** `CreateIntegrationDto`. */
export interface IntegrationInput {
  providerId: string;
  credentialId?: string;
  code: string;
  name: string;
  environment?: IntegrationEnvironment;
  parameters?: Record<string, unknown>;
  timeoutMs?: number;
  maxAttempts?: number;
  failureThreshold?: number;
  note?: string;
}

/** `UpdateIntegrationDto` — `code`, `providerId` e `status` ficam de fora. */
export type IntegrationUpdate = Partial<Omit<IntegrationInput, 'code' | 'providerId'>> & {
  isActive?: boolean;
};

export type IntegrationEventSeverity = 'INFO' | 'AVISO' | 'ERRO' | 'CRITICO';

/** Linha do diário de integrações (RF-129). */
export interface IntegrationEvent {
  id: string;
  integrationId: string | null;
  providerId: string | null;
  type: string;
  severity: IntegrationEventSeverity;
  operation: string | null;
  message: string;
  detail: Record<string, unknown> | null;
  referenceType: string | null;
  referenceId: string | null;
  httpStatus: number | null;
  durationMs: number | null;
  attempt: number | null;
  correlationId: string | null;
  occurredAt: string;
  integration: { id: string; code: string; name: string } | null;
}

/** Saúde de uma integração no painel (RF-128). */
export interface IntegrationHealthRow {
  id: string;
  code: string;
  name: string;
  status: IntegrationStatus;
  isActive: boolean;
  provider: { code: string; category: string };
  failureStreak: number;
  failureThreshold: number;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  events24h: number;
  errors24h: number;
  lastErrorEventAt: string | null;
  /** Ainda responde, mas já acumulou falha: é o que se olha antes de suspender. */
  degraded: boolean;
}
