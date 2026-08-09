import { PermissionAction } from '@prisma/client';

/**
 * Catálogo de permissões da Sprint 1 (RF-011).
 * Fonte única de verdade: usado pelo seed (para popular a tabela Permission)
 * e pelos controllers (via @RequirePermissions). Cada permissão é
 * `recurso:AÇÃO` e pertence a um módulo da ERS.
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
} as const;

export interface PermissionDefinition {
  code: string;
  module: string;
  resource: string;
  action: PermissionAction;
  description: string;
}

function build(
  module: string,
  resource: string,
  actions: { action: PermissionAction; description: string }[],
): PermissionDefinition[] {
  return actions.map(({ action, description }) => ({
    code: `${resource}:${action}`,
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
];

/** Constantes de código para uso nos decorators @RequirePermissions. */
export const PERMISSIONS = {
  COMPANY_READ: `${RESOURCES.COMPANY}:${A.READ}`,
  COMPANY_UPDATE: `${RESOURCES.COMPANY}:${A.UPDATE}`,

  BRANCHES_CREATE: `${RESOURCES.BRANCHES}:${A.CREATE}`,
  BRANCHES_READ: `${RESOURCES.BRANCHES}:${A.READ}`,
  BRANCHES_UPDATE: `${RESOURCES.BRANCHES}:${A.UPDATE}`,
  BRANCHES_DELETE: `${RESOURCES.BRANCHES}:${A.DELETE}`,

  CATEGORIES_CREATE: `${RESOURCES.CATEGORIES}:${A.CREATE}`,
  CATEGORIES_READ: `${RESOURCES.CATEGORIES}:${A.READ}`,
  CATEGORIES_UPDATE: `${RESOURCES.CATEGORIES}:${A.UPDATE}`,
  CATEGORIES_DELETE: `${RESOURCES.CATEGORIES}:${A.DELETE}`,

  COST_CENTERS_CREATE: `${RESOURCES.COST_CENTERS}:${A.CREATE}`,
  COST_CENTERS_READ: `${RESOURCES.COST_CENTERS}:${A.READ}`,
  COST_CENTERS_UPDATE: `${RESOURCES.COST_CENTERS}:${A.UPDATE}`,
  COST_CENTERS_DELETE: `${RESOURCES.COST_CENTERS}:${A.DELETE}`,

  SETTINGS_READ: `${RESOURCES.SETTINGS}:${A.READ}`,
  SETTINGS_UPDATE: `${RESOURCES.SETTINGS}:${A.UPDATE}`,

  ROLES_CREATE: `${RESOURCES.ROLES}:${A.CREATE}`,
  ROLES_READ: `${RESOURCES.ROLES}:${A.READ}`,
  ROLES_UPDATE: `${RESOURCES.ROLES}:${A.UPDATE}`,
  ROLES_DELETE: `${RESOURCES.ROLES}:${A.DELETE}`,

  MEMBERSHIPS_CREATE: `${RESOURCES.MEMBERSHIPS}:${A.CREATE}`,
  MEMBERSHIPS_READ: `${RESOURCES.MEMBERSHIPS}:${A.READ}`,
  MEMBERSHIPS_UPDATE: `${RESOURCES.MEMBERSHIPS}:${A.UPDATE}`,
  MEMBERSHIPS_DELETE: `${RESOURCES.MEMBERSHIPS}:${A.DELETE}`,

  APPROVAL_THRESHOLDS_CREATE: `${RESOURCES.APPROVAL_THRESHOLDS}:${A.CREATE}`,
  APPROVAL_THRESHOLDS_READ: `${RESOURCES.APPROVAL_THRESHOLDS}:${A.READ}`,
  APPROVAL_THRESHOLDS_UPDATE: `${RESOURCES.APPROVAL_THRESHOLDS}:${A.UPDATE}`,
  APPROVAL_THRESHOLDS_DELETE: `${RESOURCES.APPROVAL_THRESHOLDS}:${A.DELETE}`,
} as const;
