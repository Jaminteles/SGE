import { PermissionAction } from '../enums';

/**
 * Catálogo de permissões da API (RF-011).
 *
 * Fonte única de verdade do backend: usado pelo seed (para popular
 * `gestao.permissao`) e pelos controllers (via @RequirePermissions).
 *
 * No banco a permissão é a tripla (modulo, recurso, acao) — não existe coluna
 * de código. O código usado na API é derivado: `recurso:AÇÃO`. A carga inicial
 * de `bd/03` traz outra família de permissões (EMPRESAS/EMPRESA/LER, ...),
 * reservada para os módulos das próximas sprints; as duas convivem porque a
 * chave única é a tripla.
 *
 * Empresas e usuários são recursos de plataforma (administrados por
 * super admin) e por isso não constam no RBAC por empresa — exceto a
 * manutenção dos dados cadastrais da própria empresa (company:READ/UPDATE),
 * que é uma operação do administrador da empresa (RF-003).
 */

export const RESOURCES = {
  COMPANY: 'company',
  BRANCHES: 'branches',
  ROLES: 'roles',
  MEMBERSHIPS: 'memberships',
  CATEGORIES: 'categories',
  COST_CENTERS: 'cost-centers',
  SETTINGS: 'settings',
  APPROVAL_THRESHOLDS: 'approval-thresholds',
  AUDIT: 'audit',
  DEPARTMENTS: 'departments',
  POSITIONS: 'positions',
  EMPLOYEES: 'employees',
  EMPLOYEE_EVENTS: 'employee-events',
  BANK_ACCOUNTS: 'employee-bank-accounts',
  PAYROLL_ITEMS: 'payroll-items',
  COMPENSATION: 'compensation',
  REIMBURSEMENTS: 'reimbursements',
  PAYROLL: 'payroll',
  PARTNERS: 'partners',
  PARTNER_CONTACTS: 'partner-contacts',
  PARTNER_BANK_ACCOUNTS: 'partner-bank-accounts',
  PARTNER_HISTORY: 'partner-history',
  PAYMENT_METHODS: 'payment-methods',
  PAYMENT_TERMS: 'payment-terms',
  PRODUCTS: 'products',
  PRODUCT_CATEGORIES: 'product-categories',
  UNITS_OF_MEASURE: 'units-of-measure',
  PRODUCT_SUPPLIERS: 'product-suppliers',
} as const;

export interface PermissionDefinition {
  code: string;
  module: string;
  resource: string;
  action: PermissionAction;
  description: string;
}

/** Código de permissão exposto pela API a partir da tripla do banco. */
export function permissionCode(resource: string, action: string): string {
  return `${resource}:${action}`;
}

function build(
  module: string,
  resource: string,
  actions: { action: PermissionAction; description: string }[],
): PermissionDefinition[] {
  return actions.map(({ action, description }) => ({
    code: permissionCode(resource, action),
    module,
    resource,
    action,
    description,
  }));
}

const A = PermissionAction;

export const PERMISSION_CATALOG: PermissionDefinition[] = [
  // M01 — Empresas, Filiais e Configurações
  ...build('M01', RESOURCES.COMPANY, [
    { action: A.READ, description: 'Visualizar dados cadastrais da empresa' },
    { action: A.UPDATE, description: 'Manter dados cadastrais da empresa' },
  ]),
  ...build('M01', RESOURCES.BRANCHES, [
    { action: A.CREATE, description: 'Cadastrar filiais' },
    { action: A.READ, description: 'Consultar filiais' },
    { action: A.UPDATE, description: 'Editar filiais' },
    { action: A.DELETE, description: 'Inativar/remover filiais' },
  ]),
  ...build('M01', RESOURCES.CATEGORIES, [
    { action: A.CREATE, description: 'Cadastrar categorias' },
    { action: A.READ, description: 'Consultar categorias' },
    { action: A.UPDATE, description: 'Editar categorias' },
    { action: A.DELETE, description: 'Inativar/remover categorias' },
  ]),
  ...build('M01', RESOURCES.COST_CENTERS, [
    { action: A.CREATE, description: 'Cadastrar centros de custo' },
    { action: A.READ, description: 'Consultar centros de custo' },
    { action: A.UPDATE, description: 'Editar centros de custo' },
    { action: A.DELETE, description: 'Inativar/remover centros de custo' },
  ]),
  ...build('M01', RESOURCES.SETTINGS, [
    { action: A.READ, description: 'Consultar parâmetros financeiros e fiscais' },
    { action: A.UPDATE, description: 'Configurar parâmetros financeiros e fiscais' },
  ]),
  // M02 — Usuários, Perfis e Permissões
  ...build('M02', RESOURCES.ROLES, [
    { action: A.CREATE, description: 'Criar perfis de acesso' },
    { action: A.READ, description: 'Consultar perfis e permissões' },
    { action: A.UPDATE, description: 'Editar perfis e permissões' },
    { action: A.DELETE, description: 'Remover perfis de acesso' },
  ]),
  ...build('M02', RESOURCES.MEMBERSHIPS, [
    { action: A.CREATE, description: 'Associar usuários à empresa' },
    { action: A.READ, description: 'Consultar associações de usuários' },
    { action: A.UPDATE, description: 'Alterar perfil/situação de usuários na empresa' },
    { action: A.DELETE, description: 'Remover associação de usuário' },
  ]),
  ...build('M02', RESOURCES.APPROVAL_THRESHOLDS, [
    { action: A.CREATE, description: 'Definir alçadas de aprovação' },
    { action: A.READ, description: 'Consultar alçadas de aprovação' },
    { action: A.UPDATE, description: 'Editar alçadas de aprovação' },
    { action: A.DELETE, description: 'Remover alçadas de aprovação' },
  ]),
  // M16 — Auditoria. A trilha é append-only (RF-118): só existe leitura, e
  // nenhuma permissão de escrita deve ser adicionada aqui.
  ...build('M16', RESOURCES.AUDIT, [
    { action: A.READ, description: 'Consultar e filtrar a trilha de auditoria' },
  ]),
  // M03 — Funcionários e Recursos Humanos.
  //
  // Dado bancário, remuneração e folha são recursos separados de propósito: são
  // os alvos preferidos de fraude (desvio de crédito) e de vazamento, e quem
  // mantém o cadastro funcional raramente precisa deles.
  ...build('M03', RESOURCES.DEPARTMENTS, [
    { action: A.CREATE, description: 'Cadastrar departamentos' },
    { action: A.READ, description: 'Consultar departamentos' },
    { action: A.UPDATE, description: 'Editar departamentos' },
    { action: A.DELETE, description: 'Inativar departamentos' },
  ]),
  ...build('M03', RESOURCES.POSITIONS, [
    { action: A.CREATE, description: 'Cadastrar cargos' },
    { action: A.READ, description: 'Consultar cargos' },
    { action: A.UPDATE, description: 'Editar cargos' },
    { action: A.DELETE, description: 'Inativar cargos' },
  ]),
  ...build('M03', RESOURCES.EMPLOYEES, [
    { action: A.CREATE, description: 'Cadastrar funcionários' },
    { action: A.READ, description: 'Consultar funcionários' },
    { action: A.UPDATE, description: 'Editar funcionários' },
    { action: A.DELETE, description: 'Desligar funcionários' },
  ]),
  ...build('M03', RESOURCES.EMPLOYEE_EVENTS, [
    { action: A.CREATE, description: 'Registrar admissão, férias, afastamento e desligamento' },
    { action: A.READ, description: 'Consultar o histórico funcional' },
  ]),
  ...build('M03', RESOURCES.BANK_ACCOUNTS, [
    { action: A.CREATE, description: 'Cadastrar dados bancários de funcionários' },
    { action: A.READ, description: 'Consultar dados bancários de funcionários' },
    { action: A.UPDATE, description: 'Editar dados bancários de funcionários' },
    { action: A.DELETE, description: 'Inativar dados bancários de funcionários' },
  ]),
  ...build('M03', RESOURCES.PAYROLL_ITEMS, [
    { action: A.CREATE, description: 'Cadastrar verbas de folha' },
    { action: A.READ, description: 'Consultar verbas de folha' },
    { action: A.UPDATE, description: 'Editar verbas de folha' },
    { action: A.DELETE, description: 'Inativar verbas de folha' },
  ]),
  ...build('M03', RESOURCES.COMPENSATION, [
    { action: A.CREATE, description: 'Atribuir salários, benefícios e descontos' },
    { action: A.READ, description: 'Consultar a remuneração do funcionário' },
    { action: A.UPDATE, description: 'Editar a remuneração do funcionário' },
    { action: A.DELETE, description: 'Encerrar a vigência de uma verba' },
  ]),
  ...build('M03', RESOURCES.REIMBURSEMENTS, [
    { action: A.CREATE, description: 'Solicitar reembolso de despesas' },
    { action: A.READ, description: 'Consultar reembolsos e comprovantes' },
    { action: A.UPDATE, description: 'Editar reembolsos em elaboração' },
    { action: A.DELETE, description: 'Cancelar reembolsos' },
    { action: A.APPROVE, description: 'Aprovar ou reprovar reembolsos' },
  ]),
  ...build('M03', RESOURCES.PAYROLL, [
    { action: A.READ, description: 'Consultar a consolidação para folha e contabilidade' },
    { action: A.EXPORT, description: 'Exportar a consolidação para folha e contabilidade' },
  ]),
  // M04 — Clientes e Fornecedores.
  //
  // Cliente e fornecedor são papéis do mesmo cadastro (`parceiro`), por isso um
  // recurso só. Dado bancário e histórico financeiro são separados pelo mesmo
  // motivo do M03: conta de crédito é alvo de fraude e o histórico expõe o
  // relacionamento comercial inteiro.
  ...build('M04', RESOURCES.PARTNERS, [
    { action: A.CREATE, description: 'Cadastrar clientes e fornecedores' },
    { action: A.READ, description: 'Consultar clientes e fornecedores' },
    { action: A.UPDATE, description: 'Editar clientes e fornecedores' },
    { action: A.DELETE, description: 'Inativar clientes e fornecedores' },
  ]),
  ...build('M04', RESOURCES.PARTNER_CONTACTS, [
    { action: A.CREATE, description: 'Cadastrar contatos e endereços de parceiros' },
    { action: A.READ, description: 'Consultar contatos e endereços de parceiros' },
    { action: A.UPDATE, description: 'Editar contatos e endereços de parceiros' },
    { action: A.DELETE, description: 'Remover contatos e endereços de parceiros' },
  ]),
  ...build('M04', RESOURCES.PARTNER_BANK_ACCOUNTS, [
    { action: A.CREATE, description: 'Cadastrar dados bancários de parceiros' },
    { action: A.READ, description: 'Consultar dados bancários de parceiros' },
    { action: A.UPDATE, description: 'Editar dados bancários de parceiros' },
    { action: A.DELETE, description: 'Inativar dados bancários de parceiros' },
  ]),
  ...build('M04', RESOURCES.PARTNER_HISTORY, [
    { action: A.READ, description: 'Consultar o histórico comercial e financeiro do parceiro' },
  ]),
  ...build('M04', RESOURCES.PAYMENT_METHODS, [
    { action: A.CREATE, description: 'Cadastrar formas de pagamento' },
    { action: A.READ, description: 'Consultar formas de pagamento' },
    { action: A.UPDATE, description: 'Editar formas de pagamento' },
    { action: A.DELETE, description: 'Inativar formas de pagamento' },
  ]),
  ...build('M04', RESOURCES.PAYMENT_TERMS, [
    { action: A.CREATE, description: 'Cadastrar condições de pagamento' },
    { action: A.READ, description: 'Consultar condições de pagamento' },
    { action: A.UPDATE, description: 'Editar condições de pagamento' },
    { action: A.DELETE, description: 'Inativar condições de pagamento' },
  ]),
  // M05 — Produtos, Serviços e Estoque (cadastro; estoque na Sprint 5).
  ...build('M05', RESOURCES.PRODUCTS, [
    { action: A.CREATE, description: 'Cadastrar produtos e serviços' },
    { action: A.READ, description: 'Consultar produtos e serviços' },
    { action: A.UPDATE, description: 'Editar produtos e serviços' },
    { action: A.DELETE, description: 'Inativar produtos e serviços' },
  ]),
  ...build('M05', RESOURCES.PRODUCT_CATEGORIES, [
    { action: A.CREATE, description: 'Cadastrar categorias de produto' },
    { action: A.READ, description: 'Consultar categorias de produto' },
    { action: A.UPDATE, description: 'Editar categorias de produto' },
    { action: A.DELETE, description: 'Inativar categorias de produto' },
  ]),
  ...build('M05', RESOURCES.UNITS_OF_MEASURE, [
    { action: A.CREATE, description: 'Cadastrar unidades de medida' },
    { action: A.READ, description: 'Consultar unidades de medida' },
    { action: A.UPDATE, description: 'Editar unidades de medida' },
    { action: A.DELETE, description: 'Inativar unidades de medida' },
  ]),
  ...build('M05', RESOURCES.PRODUCT_SUPPLIERS, [
    { action: A.CREATE, description: 'Associar fornecedores a produtos e serviços' },
    { action: A.READ, description: 'Consultar fornecedores de produtos e serviços' },
    { action: A.UPDATE, description: 'Editar o vínculo entre fornecedor e produto' },
    { action: A.DELETE, description: 'Remover o vínculo entre fornecedor e produto' },
  ]),
];

/** Índice por código, para resolver (recurso, ação) na consulta ao banco. */
export const PERMISSION_BY_CODE = new Map(PERMISSION_CATALOG.map((p) => [p.code, p]));

/** Constantes de código para uso nos decorators @RequirePermissions. */
export const PERMISSIONS = {
  COMPANY_READ: permissionCode(RESOURCES.COMPANY, A.READ),
  COMPANY_UPDATE: permissionCode(RESOURCES.COMPANY, A.UPDATE),

  BRANCHES_CREATE: permissionCode(RESOURCES.BRANCHES, A.CREATE),
  BRANCHES_READ: permissionCode(RESOURCES.BRANCHES, A.READ),
  BRANCHES_UPDATE: permissionCode(RESOURCES.BRANCHES, A.UPDATE),
  BRANCHES_DELETE: permissionCode(RESOURCES.BRANCHES, A.DELETE),

  CATEGORIES_CREATE: permissionCode(RESOURCES.CATEGORIES, A.CREATE),
  CATEGORIES_READ: permissionCode(RESOURCES.CATEGORIES, A.READ),
  CATEGORIES_UPDATE: permissionCode(RESOURCES.CATEGORIES, A.UPDATE),
  CATEGORIES_DELETE: permissionCode(RESOURCES.CATEGORIES, A.DELETE),

  COST_CENTERS_CREATE: permissionCode(RESOURCES.COST_CENTERS, A.CREATE),
  COST_CENTERS_READ: permissionCode(RESOURCES.COST_CENTERS, A.READ),
  COST_CENTERS_UPDATE: permissionCode(RESOURCES.COST_CENTERS, A.UPDATE),
  COST_CENTERS_DELETE: permissionCode(RESOURCES.COST_CENTERS, A.DELETE),

  SETTINGS_READ: permissionCode(RESOURCES.SETTINGS, A.READ),
  SETTINGS_UPDATE: permissionCode(RESOURCES.SETTINGS, A.UPDATE),

  ROLES_CREATE: permissionCode(RESOURCES.ROLES, A.CREATE),
  ROLES_READ: permissionCode(RESOURCES.ROLES, A.READ),
  ROLES_UPDATE: permissionCode(RESOURCES.ROLES, A.UPDATE),
  ROLES_DELETE: permissionCode(RESOURCES.ROLES, A.DELETE),

  MEMBERSHIPS_CREATE: permissionCode(RESOURCES.MEMBERSHIPS, A.CREATE),
  MEMBERSHIPS_READ: permissionCode(RESOURCES.MEMBERSHIPS, A.READ),
  MEMBERSHIPS_UPDATE: permissionCode(RESOURCES.MEMBERSHIPS, A.UPDATE),
  MEMBERSHIPS_DELETE: permissionCode(RESOURCES.MEMBERSHIPS, A.DELETE),

  APPROVAL_THRESHOLDS_CREATE: permissionCode(RESOURCES.APPROVAL_THRESHOLDS, A.CREATE),
  APPROVAL_THRESHOLDS_READ: permissionCode(RESOURCES.APPROVAL_THRESHOLDS, A.READ),
  APPROVAL_THRESHOLDS_UPDATE: permissionCode(RESOURCES.APPROVAL_THRESHOLDS, A.UPDATE),
  APPROVAL_THRESHOLDS_DELETE: permissionCode(RESOURCES.APPROVAL_THRESHOLDS, A.DELETE),

  AUDIT_READ: permissionCode(RESOURCES.AUDIT, A.READ),

  DEPARTMENTS_CREATE: permissionCode(RESOURCES.DEPARTMENTS, A.CREATE),
  DEPARTMENTS_READ: permissionCode(RESOURCES.DEPARTMENTS, A.READ),
  DEPARTMENTS_UPDATE: permissionCode(RESOURCES.DEPARTMENTS, A.UPDATE),
  DEPARTMENTS_DELETE: permissionCode(RESOURCES.DEPARTMENTS, A.DELETE),

  POSITIONS_CREATE: permissionCode(RESOURCES.POSITIONS, A.CREATE),
  POSITIONS_READ: permissionCode(RESOURCES.POSITIONS, A.READ),
  POSITIONS_UPDATE: permissionCode(RESOURCES.POSITIONS, A.UPDATE),
  POSITIONS_DELETE: permissionCode(RESOURCES.POSITIONS, A.DELETE),

  EMPLOYEES_CREATE: permissionCode(RESOURCES.EMPLOYEES, A.CREATE),
  EMPLOYEES_READ: permissionCode(RESOURCES.EMPLOYEES, A.READ),
  EMPLOYEES_UPDATE: permissionCode(RESOURCES.EMPLOYEES, A.UPDATE),
  EMPLOYEES_DELETE: permissionCode(RESOURCES.EMPLOYEES, A.DELETE),

  EMPLOYEE_EVENTS_CREATE: permissionCode(RESOURCES.EMPLOYEE_EVENTS, A.CREATE),
  EMPLOYEE_EVENTS_READ: permissionCode(RESOURCES.EMPLOYEE_EVENTS, A.READ),

  BANK_ACCOUNTS_CREATE: permissionCode(RESOURCES.BANK_ACCOUNTS, A.CREATE),
  BANK_ACCOUNTS_READ: permissionCode(RESOURCES.BANK_ACCOUNTS, A.READ),
  BANK_ACCOUNTS_UPDATE: permissionCode(RESOURCES.BANK_ACCOUNTS, A.UPDATE),
  BANK_ACCOUNTS_DELETE: permissionCode(RESOURCES.BANK_ACCOUNTS, A.DELETE),

  PAYROLL_ITEMS_CREATE: permissionCode(RESOURCES.PAYROLL_ITEMS, A.CREATE),
  PAYROLL_ITEMS_READ: permissionCode(RESOURCES.PAYROLL_ITEMS, A.READ),
  PAYROLL_ITEMS_UPDATE: permissionCode(RESOURCES.PAYROLL_ITEMS, A.UPDATE),
  PAYROLL_ITEMS_DELETE: permissionCode(RESOURCES.PAYROLL_ITEMS, A.DELETE),

  COMPENSATION_CREATE: permissionCode(RESOURCES.COMPENSATION, A.CREATE),
  COMPENSATION_READ: permissionCode(RESOURCES.COMPENSATION, A.READ),
  COMPENSATION_UPDATE: permissionCode(RESOURCES.COMPENSATION, A.UPDATE),
  COMPENSATION_DELETE: permissionCode(RESOURCES.COMPENSATION, A.DELETE),

  REIMBURSEMENTS_CREATE: permissionCode(RESOURCES.REIMBURSEMENTS, A.CREATE),
  REIMBURSEMENTS_READ: permissionCode(RESOURCES.REIMBURSEMENTS, A.READ),
  REIMBURSEMENTS_UPDATE: permissionCode(RESOURCES.REIMBURSEMENTS, A.UPDATE),
  REIMBURSEMENTS_DELETE: permissionCode(RESOURCES.REIMBURSEMENTS, A.DELETE),
  REIMBURSEMENTS_APPROVE: permissionCode(RESOURCES.REIMBURSEMENTS, A.APPROVE),

  PAYROLL_READ: permissionCode(RESOURCES.PAYROLL, A.READ),
  PAYROLL_EXPORT: permissionCode(RESOURCES.PAYROLL, A.EXPORT),

  PARTNERS_CREATE: permissionCode(RESOURCES.PARTNERS, A.CREATE),
  PARTNERS_READ: permissionCode(RESOURCES.PARTNERS, A.READ),
  PARTNERS_UPDATE: permissionCode(RESOURCES.PARTNERS, A.UPDATE),
  PARTNERS_DELETE: permissionCode(RESOURCES.PARTNERS, A.DELETE),

  PARTNER_CONTACTS_CREATE: permissionCode(RESOURCES.PARTNER_CONTACTS, A.CREATE),
  PARTNER_CONTACTS_READ: permissionCode(RESOURCES.PARTNER_CONTACTS, A.READ),
  PARTNER_CONTACTS_UPDATE: permissionCode(RESOURCES.PARTNER_CONTACTS, A.UPDATE),
  PARTNER_CONTACTS_DELETE: permissionCode(RESOURCES.PARTNER_CONTACTS, A.DELETE),

  PARTNER_BANK_ACCOUNTS_CREATE: permissionCode(RESOURCES.PARTNER_BANK_ACCOUNTS, A.CREATE),
  PARTNER_BANK_ACCOUNTS_READ: permissionCode(RESOURCES.PARTNER_BANK_ACCOUNTS, A.READ),
  PARTNER_BANK_ACCOUNTS_UPDATE: permissionCode(RESOURCES.PARTNER_BANK_ACCOUNTS, A.UPDATE),
  PARTNER_BANK_ACCOUNTS_DELETE: permissionCode(RESOURCES.PARTNER_BANK_ACCOUNTS, A.DELETE),

  PARTNER_HISTORY_READ: permissionCode(RESOURCES.PARTNER_HISTORY, A.READ),

  PAYMENT_METHODS_CREATE: permissionCode(RESOURCES.PAYMENT_METHODS, A.CREATE),
  PAYMENT_METHODS_READ: permissionCode(RESOURCES.PAYMENT_METHODS, A.READ),
  PAYMENT_METHODS_UPDATE: permissionCode(RESOURCES.PAYMENT_METHODS, A.UPDATE),
  PAYMENT_METHODS_DELETE: permissionCode(RESOURCES.PAYMENT_METHODS, A.DELETE),

  PAYMENT_TERMS_CREATE: permissionCode(RESOURCES.PAYMENT_TERMS, A.CREATE),
  PAYMENT_TERMS_READ: permissionCode(RESOURCES.PAYMENT_TERMS, A.READ),
  PAYMENT_TERMS_UPDATE: permissionCode(RESOURCES.PAYMENT_TERMS, A.UPDATE),
  PAYMENT_TERMS_DELETE: permissionCode(RESOURCES.PAYMENT_TERMS, A.DELETE),

  PRODUCTS_CREATE: permissionCode(RESOURCES.PRODUCTS, A.CREATE),
  PRODUCTS_READ: permissionCode(RESOURCES.PRODUCTS, A.READ),
  PRODUCTS_UPDATE: permissionCode(RESOURCES.PRODUCTS, A.UPDATE),
  PRODUCTS_DELETE: permissionCode(RESOURCES.PRODUCTS, A.DELETE),

  PRODUCT_CATEGORIES_CREATE: permissionCode(RESOURCES.PRODUCT_CATEGORIES, A.CREATE),
  PRODUCT_CATEGORIES_READ: permissionCode(RESOURCES.PRODUCT_CATEGORIES, A.READ),
  PRODUCT_CATEGORIES_UPDATE: permissionCode(RESOURCES.PRODUCT_CATEGORIES, A.UPDATE),
  PRODUCT_CATEGORIES_DELETE: permissionCode(RESOURCES.PRODUCT_CATEGORIES, A.DELETE),

  UNITS_OF_MEASURE_CREATE: permissionCode(RESOURCES.UNITS_OF_MEASURE, A.CREATE),
  UNITS_OF_MEASURE_READ: permissionCode(RESOURCES.UNITS_OF_MEASURE, A.READ),
  UNITS_OF_MEASURE_UPDATE: permissionCode(RESOURCES.UNITS_OF_MEASURE, A.UPDATE),
  UNITS_OF_MEASURE_DELETE: permissionCode(RESOURCES.UNITS_OF_MEASURE, A.DELETE),

  PRODUCT_SUPPLIERS_CREATE: permissionCode(RESOURCES.PRODUCT_SUPPLIERS, A.CREATE),
  PRODUCT_SUPPLIERS_READ: permissionCode(RESOURCES.PRODUCT_SUPPLIERS, A.READ),
  PRODUCT_SUPPLIERS_UPDATE: permissionCode(RESOURCES.PRODUCT_SUPPLIERS, A.UPDATE),
  PRODUCT_SUPPLIERS_DELETE: permissionCode(RESOURCES.PRODUCT_SUPPLIERS, A.DELETE),
} as const;
