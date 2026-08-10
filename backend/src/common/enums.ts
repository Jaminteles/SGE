/**
 * Enums de aplicação.
 *
 * O banco (`bd/*.sql`) modela situação com a coluna booleana `ativo`, e não com
 * um enum de status — por isso a API expõe `isActive`. Os enums abaixo existem
 * apenas no backend: não têm tipo correspondente no PostgreSQL.
 */

/** Ações de permissão por operação (RF-011). */
export enum PermissionAction {
  CREATE = 'CREATE',
  READ = 'READ',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  APPROVE = 'APPROVE',
  EXPORT = 'EXPORT',
}

/**
 * Grupo do parâmetro da empresa (RF-006) — gravado em
 * `parametro_empresa.grupo`, que é `varchar(60)` livre no banco.
 */
export enum SettingScope {
  FINANCEIRO = 'FINANCEIRO',
  FISCAL = 'FISCAL',
  GERAL = 'GERAL',
}
