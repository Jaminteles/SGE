import { PrismaClient } from '@prisma/client';

/**
 * Verifica se o banco criado por `bd/*.sql` está pronto para a API:
 * schema correto, scripts de ajuste aplicados, RLS ativa e catálogo carregado.
 *
 *   npm run db:check
 */
const prisma = new PrismaClient();

interface Check {
  label: string;
  ok: boolean;
  detail: string;
}

async function scalar<T>(query: Promise<T[]>): Promise<T | undefined> {
  const rows = await query;
  return rows[0];
}

async function main(): Promise<void> {
  const checks: Check[] = [];

  const schema = await scalar(
    prisma.$queryRaw<{ v: string }[]>`SELECT current_schema()::text AS v`,
  );
  checks.push({
    label: 'search_path aponta para o schema gestao',
    ok: schema?.v === 'gestao',
    detail: `current_schema() = ${schema?.v ?? '?'} (ajuste ?schema=gestao na DATABASE_URL)`,
  });

  const tables = await scalar(
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM information_schema.tables WHERE table_schema = 'gestao'
    `,
  );
  checks.push({
    label: 'tabelas do modelo físico criadas',
    ok: Number(tables?.n ?? 0) >= 90,
    detail: `${Number(tables?.n ?? 0)} tabelas (esperado ≥ 90 — rode bd/01, 02 e 03)`,
  });

  const superAdmin = await scalar(
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM information_schema.columns
       WHERE table_schema = 'gestao' AND table_name = 'usuario' AND column_name = 'super_admin'
    `,
  );
  checks.push({
    label: 'ajustes de integração aplicados (bd/04)',
    ok: Number(superAdmin?.n ?? 0) === 1,
    detail: 'coluna usuario.super_admin — rode bd/04_ajustes_integracao_backend.sql',
  });

  const policies = await scalar(
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM pg_policies WHERE schemaname = 'gestao'
    `,
  );
  checks.push({
    label: 'RLS multiempresa configurada',
    ok: Number(policies?.n ?? 0) > 0,
    detail: `${Number(policies?.n ?? 0)} políticas ativas`,
  });

  // Sprint 2 (M16): a trilha só é confiável com a RLS de leitura e sem
  // privilégio de escrita destrutiva sobre `auditoria` (RF-118).
  const auditPolicy = await scalar(
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM pg_policies
       WHERE schemaname = 'gestao' AND tablename = 'auditoria'
         AND policyname = 'pol_auditoria_tenant_leitura'
    `,
  );
  checks.push({
    label: 'auditoria isolada por empresa (bd/05)',
    ok: Number(auditPolicy?.n ?? 0) === 1,
    detail: 'política pol_auditoria_tenant_leitura — rode bd/05_auditoria_sprint2.sql',
  });

  const auditWritable = await scalar(
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM information_schema.table_privileges
       WHERE table_schema = 'gestao' AND table_name = 'auditoria'
         AND grantee IN ('app_gestao', 'sge_api')
         AND privilege_type IN ('UPDATE', 'DELETE')
    `,
  );
  checks.push({
    label: 'trilha de auditoria append-only (RF-118)',
    ok: Number(auditWritable?.n ?? 0) === 0,
    detail: `${Number(auditWritable?.n ?? 0)} privilégio(s) de UPDATE/DELETE concedidos — rode bd/05`,
  });

  // Sprint 3 (M03): sem as FKs compostas, um cadastro de RH pode apontar para
  // outra empresa; sem os triggers, salário e dado bancário mudam sem trilha.
  const tenantFks = await scalar(
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM pg_constraint
       WHERE contype = 'f' AND conname LIKE 'fk\\_%\\_tenant'
    `,
  );
  checks.push({
    label: 'referências de RH presas à empresa (bd/06)',
    ok: Number(tenantFks?.n ?? 0) >= 22,
    detail: `${Number(tenantFks?.n ?? 0)} FKs compostas (esperado ≥ 22) — rode bd/06_rh_sprint3.sql`,
  });

  const hrTriggers = await scalar(
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM pg_trigger
       WHERE NOT tgisinternal
         AND tgname IN ('trg_funcionario_auditoria', 'trg_reembolso_auditoria',
                        'trg_dado_bancario_auditoria', 'trg_funcionario_verba_auditoria',
                        'trg_funcionario_evento_aplica', 'trg_reembolso_item_total')
    `,
  );
  checks.push({
    label: 'regras e auditoria do M03 aplicadas (bd/06)',
    ok: Number(hrTriggers?.n ?? 0) >= 6,
    detail: `${Number(hrTriggers?.n ?? 0)} triggers de 6 — rode bd/06_rh_sprint3.sql`,
  });

  const permissions = await prisma.permission.count({
    where: { module: { in: ['M01', 'M02', 'M03', 'M16'] } },
  });
  checks.push({
    label: 'catálogo de permissões da API carregado',
    ok: permissions > 0,
    detail: `${permissions} permissões M01/M02/M03/M16 — rode npm run db:seed`,
  });

  const admins = await prisma.user.count({ where: { isSuperAdmin: true, isActive: true } });
  checks.push({
    label: 'super admin disponível',
    ok: admins > 0,
    detail: `${admins} usuário(s) — rode npm run db:seed`,
  });

  for (const c of checks) {
    console.log(`${c.ok ? '✔' : '✘'} ${c.label}\n    ${c.detail}`);
  }

  if (checks.some((c) => !c.ok)) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error('Falha na verificação:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
