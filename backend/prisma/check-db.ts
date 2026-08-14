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

  // Só tabelas base, e sem as partições de `auditoria`: a contagem precisa ser
  // estável. `information_schema.tables` não serve aqui — inclui views, filtra
  // por privilégio (o da trilha é revogado em bd/05) e cresce a cada partição
  // mensal nova, o que faria o limiar envelhecer sozinho.
  const tables = await scalar(
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'gestao'
         AND c.relkind IN ('r', 'p')
         AND NOT c.relispartition
    `,
  );
  checks.push({
    label: 'tabelas do modelo físico criadas',
    ok: Number(tables?.n ?? 0) >= 80,
    detail: `${Number(tables?.n ?? 0)} tabelas base (esperado ≥ 80 — rode bd/01, 02 e 03)`,
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

  // Sprints 3 a 5: sem as FKs compostas, um cadastro pode apontar para outra
  // empresa; sem os triggers, salário e dado bancário mudam sem trilha.
  const tenantFks = await scalar(
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM pg_constraint
       WHERE contype = 'f' AND conname LIKE 'fk\\_%\\_tenant'
    `,
  );
  checks.push({
    label: 'referências de cadastro presas à empresa (bd/06 a bd/09)',
    ok: Number(tenantFks?.n ?? 0) >= 63,
    detail: `${Number(tenantFks?.n ?? 0)} FKs compostas (esperado ≥ 63) — rode bd/06 a bd/09`,
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

  // Sprint 4 (M04/M05): sem os triggers de papel, uma linha de fornecedor pode
  // existir para quem não vende; sem os índices, há mais de um principal.
  const partnerRules = await scalar(
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM pg_trigger
       WHERE NOT tgisinternal
         AND tgname IN ('trg_cliente_papel', 'trg_fornecedor_papel',
                        'trg_produto_fornecedor_papel', 'trg_categoria_produto_hierarquia')
    `,
  );
  checks.push({
    label: 'regras do M04/M05 aplicadas (bd/07)',
    ok: Number(partnerRules?.n ?? 0) >= 4,
    detail: `${Number(partnerRules?.n ?? 0)} triggers de 4 — rode bd/07_parceiros_produtos_sprint4.sql`,
  });

  const uniquePrimary = await scalar(
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM pg_indexes
       WHERE schemaname = 'gestao'
         AND indexname IN ('ux_endereco_parceiro_principal', 'ux_contato_parceiro_principal',
                           'ux_dado_bancario_parceiro_principal',
                           'ux_produto_fornecedor_preferencial')
    `,
  );
  checks.push({
    label: 'um principal/preferencial por parceiro e item (bd/07)',
    ok: Number(uniquePrimary?.n ?? 0) >= 4,
    detail: `${Number(uniquePrimary?.n ?? 0)} índices de 4 — rode bd/07_parceiros_produtos_sprint4.sql`,
  });

  // Sprint 5 (M05 Estoque): sem os triggers, o saldo é gravado sem o
  // lançamento que o explica e o custo médio fica incoerente com o valor.
  const stockRules = await scalar(
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM pg_trigger
       WHERE NOT tgisinternal
         AND tgname IN ('trg_prepara_movimento_estoque', 'trg_aplica_movimento_estoque',
                        'trg_movimento_estoque_imutavel', 'trg_inventario_status',
                        'trg_inventario_item_valida')
    `,
  );
  checks.push({
    label: 'regras do estoque aplicadas (bd/08)',
    ok: Number(stockRules?.n ?? 0) >= 5,
    detail: `${Number(stockRules?.n ?? 0)} triggers de 5 — rode bd/08_estoque_sprint5.sql`,
  });

  // O razão é a única porta de entrada do estoque (RF-031/RF-032): com UPDATE
  // em `estoque_saldo`, um saldo pode ser acertado sem deixar lançamento.
  const stockWritable = await scalar(
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM information_schema.table_privileges
       WHERE table_schema = 'gestao'
         AND table_name IN ('estoque_saldo', 'movimento_estoque')
         AND grantee IN ('app_gestao', 'sge_api')
         AND privilege_type IN ('UPDATE', 'DELETE')
    `,
  );
  checks.push({
    label: 'saldo projetado e razão append-only (RF-031/RF-032)',
    ok: Number(stockWritable?.n ?? 0) === 0,
    detail: `${Number(stockWritable?.n ?? 0)} privilégio(s) de UPDATE/DELETE concedidos — rode bd/08`,
  });

  // Sprint 6 (M08): sem os triggers, o saldo do título deixa de acompanhar as
  // baixas e uma parcela pode ser paga duas vezes.
  const financeRules = await scalar(
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM pg_trigger
       WHERE NOT tgisinternal
         AND tgname IN ('trg_prepara_titulo', 'trg_titulo_parcelas_somam',
                        'trg_parcela_soma_titulo', 'trg_prepara_parcela',
                        'trg_titulo_aprovacao', 'trg_prepara_baixa',
                        'trg_baixa_imutavel', 'trg_aplica_estorno_baixa')
    `,
  );
  checks.push({
    label: 'regras do contas a pagar/receber aplicadas (bd/09)',
    ok: Number(financeRules?.n ?? 0) >= 8,
    detail: `${Number(financeRules?.n ?? 0)} triggers de 8 — rode bd/09_financeiro_sprint6.sql`,
  });

  // A baixa é a única porta de entrada da liquidação (RF-057): com UPDATE em
  // `titulo_baixa`, um pagamento pode ser reescrito sem deixar o estorno.
  const settlementWritable = await scalar(
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM information_schema.table_privileges
       WHERE table_schema = 'gestao' AND table_name = 'titulo_baixa'
         AND grantee IN ('app_gestao', 'sge_api')
         AND privilege_type IN ('UPDATE', 'DELETE')
    `,
  );
  checks.push({
    label: 'baixas append-only (RF-057)',
    ok: Number(settlementWritable?.n ?? 0) === 0,
    detail: `${Number(settlementWritable?.n ?? 0)} privilégio(s) de UPDATE/DELETE concedidos — rode bd/09`,
  });

  const portfolioViews = await scalar(
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM pg_views
       WHERE schemaname = 'gestao'
         AND viewname IN ('vw_parcela_posicao', 'vw_inadimplencia')
    `,
  );
  checks.push({
    label: 'posição da carteira e inadimplência disponíveis (RF-055/RF-058)',
    ok: Number(portfolioViews?.n ?? 0) >= 2,
    detail: `${Number(portfolioViews?.n ?? 0)} visões de 2 — rode bd/09_financeiro_sprint6.sql`,
  });

  const permissions = await prisma.permission.count({
    where: { module: { in: ['M01', 'M02', 'M03', 'M04', 'M05', 'M08', 'M16'] } },
  });
  checks.push({
    label: 'catálogo de permissões da API carregado',
    ok: permissions > 0,
    detail: `${permissions} permissões M01/M02/M03/M04/M05/M08/M16 — rode npm run db:seed`,
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
