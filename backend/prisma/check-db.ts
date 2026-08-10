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

  const permissions = await prisma.permission.count({
    where: { module: { in: ['M01', 'M02'] } },
  });
  checks.push({
    label: 'catálogo de permissões da API carregado',
    ok: permissions > 0,
    detail: `${permissions} permissões M01/M02 — rode npm run db:seed`,
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
