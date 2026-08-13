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

/**
 * Situação do inventário (RF-033) — gravada em `inventario.status`, que é
 * `varchar(20)` com CHECK no banco (bd/08), e não um enum do PostgreSQL.
 */
export enum InventoryStatus {
  ABERTO = 'ABERTO',
  EM_CONTAGEM = 'EM_CONTAGEM',
  CONCLUIDO = 'CONCLUIDO',
  CANCELADO = 'CANCELADO',
}
