import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import {
  PERMISSION_CATALOG,
  PERMISSIONS,
  RESOURCES,
} from '../src/common/authorization/permission-catalog';

/**
 * Carga inicial do backend sobre o banco criado por `bd/*.sql`.
 *
 * Não cria tabelas: sincroniza o catálogo de permissões da API em
 * `gestao.permissao`, vincula-o aos perfis de sistema e garante o super admin.
 *
 * Roda fora do contexto de requisição, sem `app.empresa_id`. Isso é seguro
 * porque só toca tabelas sem RLS (`permissao`, `usuario`, `perfil_permissao`) ou
 * linhas de empresa nula — os perfis de sistema, que a política de tenant libera
 * justamente por serem globais.
 */
const prisma = new PrismaClient();

const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };

async function seedPermissions(): Promise<void> {
  for (const p of PERMISSION_CATALOG) {
    await prisma.permission.upsert({
      where: {
        module_resource_action: { module: p.module, resource: p.resource, action: p.action },
      },
      create: {
        module: p.module,
        resource: p.resource,
        action: p.action,
        description: p.description,
      },
      update: { description: p.description },
    });
  }
  console.log(`✔ ${PERMISSION_CATALOG.length} permissões sincronizadas.`);
}

/**
 * Vincula o catálogo da API aos perfis de sistema de `bd/03`.
 *
 * O script SQL dá "todas as permissões" ao ADMINISTRADOR num CROSS JOIN que roda
 * antes de este seed existir: as permissões da API são criadas depois e ficariam
 * de fora. Aqui o vínculo é refeito a cada execução, o que também cobre as
 * permissões acrescentadas por sprints novas.
 */
async function seedSystemRoles(): Promise<void> {
  const grants: { role: string; codes: string[] | 'all' }[] = [
    { role: 'ADMINISTRADOR', codes: 'all' },
    // RF-117: o Auditor é o responsável pelo requisito e precisa da trilha —
    // somente leitura, que é tudo o que o módulo expõe (RF-118).
    { role: 'AUDITOR', codes: [PERMISSIONS.AUDIT_READ] },
    // M03: o perfil RH mantém o cadastro funcional inteiro. A aprovação de
    // reembolso fica de fora de propósito — quem lança não decide (RN-003);
    // atribua `reimbursements:APPROVE` ao perfil que responde pela alçada.
    {
      role: 'RH',
      codes: PERMISSION_CATALOG.filter(
        (p) => p.module === 'M03' && p.code !== PERMISSIONS.REIMBURSEMENTS_APPROVE,
      ).map((p) => p.code),
    },
    // M04/M05/M06: Compras mantém parceiros e catálogo e conduz o pedido. O
    // dado bancário do parceiro fica de fora — é a conta para onde o pagamento
    // vai, e quem negocia o preço não deve poder redirecionar o crédito (mesma
    // razão do M03). Movimentar e ajustar estoque também não é de Compras: quem
    // compra não deve poder dar baixa no que chegou — e, pela mesma razão,
    // `goods-receipts:CREATE` fica com quem recebe a mercadoria (Operacional).
    // Aprovar o próprio pedido também não (RN-003): atribua
    // `purchase-orders:APPROVE` ao perfil que responde pela alçada (RF-012).
    {
      role: 'COMPRAS',
      codes: PERMISSION_CATALOG.filter(
        (p) =>
          (p.module === 'M04' || p.module === 'M05' || p.module === 'M06') &&
          p.resource !== RESOURCES.PARTNER_BANK_ACCOUNTS &&
          p.resource !== RESOURCES.STOCK_MOVEMENTS &&
          p.resource !== RESOURCES.INVENTORIES &&
          p.code !== PERMISSIONS.PURCHASE_ORDERS_APPROVE &&
          p.code !== PERMISSIONS.GOODS_RECEIPTS_CREATE,
      ).map((p) => p.code),
    },
    // Financeiro é quem paga e cobra: o M08 inteiro, mais a conta do parceiro e
    // o histórico. A aprovação do título fica de fora pela mesma razão do
    // reembolso (RN-003) — quem lança a despesa não decide sobre ela, e o
    // título a pagar é justamente onde uma despesa inventada vira dinheiro
    // saindo. Atribua `financial-entries:APPROVE` ao perfil que responde pela
    // alçada (RF-012).
    {
      role: 'FINANCEIRO',
      codes: [
        ...PERMISSION_CATALOG.filter(
          (p) => p.module === 'M08' && p.code !== PERMISSIONS.FINANCIAL_ENTRIES_APPROVE,
        ).map((p) => p.code),
        ...PERMISSION_CATALOG.filter((p) => p.resource === RESOURCES.PARTNER_BANK_ACCOUNTS).map(
          (p) => p.code,
        ),
        PERMISSIONS.PARTNERS_READ,
        PERMISSIONS.PARTNER_HISTORY_READ,
        PERMISSIONS.PAYMENT_METHODS_READ,
        PERMISSIONS.PAYMENT_TERMS_READ,
        // RF-034: o estoque é ativo no balanço — a valorização é leitura do
        // Financeiro, não de quem opera o depósito.
        PERMISSIONS.STOCK_VALUATION_READ,
        PERMISSIONS.STOCK_READ,
        // M14: quem opera o caixa precisa enxergar o fluxo e o aviso de
        // insuficiência. Criar cenário e mexer no saldo mínimo do alerta, não:
        // planejar é do Diretor, e afrouxar o próprio alerta seria apagar o
        // aviso de que o dinheiro vai faltar.
        PERMISSIONS.CASH_FLOW_READ,
        PERMISSIONS.CASH_FLOW_SCENARIOS_READ,
        PERMISSIONS.CASH_ALERTS_READ,
        // M06: o título a pagar da compra nasce do recebimento — sem enxergar o
        // pedido e o preço praticado, o Financeiro paga sem conferir contra o
        // que foi combinado. Só leitura: quem paga não pede nem confere.
        PERMISSIONS.PURCHASE_ORDERS_READ,
        PERMISSIONS.GOODS_RECEIPTS_READ,
        PERMISSIONS.PURCHASE_HISTORY_READ,
        // M07: pagar sem enxergar a nota é pagar contra o que alguém digitou.
        // Só leitura — importar e vincular é do Fiscal.
        PERMISSIONS.FISCAL_DOCUMENTS_READ,
        // M09: é o Financeiro quem paga. Vem o módulo bancário inteiro, com
        // duas exclusões que seguem a mesma lógica das outras alçadas (RN-003):
        //
        //  - `payments:APPROVE` é a confirmação manual — a afirmação de que o
        //    banco pagou, sem que ninguém tenha falado com o banco, e é ela que
        //    gera a baixa do título. Quem emite a ordem não a confirma;
        //  - a escrita de `integration-credentials` guarda o que assina a ordem
        //    no banco, e quem a tem pode apontar a integração para outro
        //    destino. É do administrador; ao Financeiro basta enxergar qual
        //    credencial está em uso.
        ...PERMISSION_CATALOG.filter(
          (p) =>
            p.module === 'M09' &&
            p.code !== PERMISSIONS.PAYMENTS_APPROVE &&
            (p.resource !== RESOURCES.INTEGRATION_CREDENTIALS ||
              p.code === PERMISSIONS.INTEGRATION_CREDENTIALS_READ),
        ).map((p) => p.code),
      ],
    },
    // M07: Fiscal é quem responde pelos RF-043 a RF-050 — importa, confere,
    // vincula e reprocessa a nota. `fiscal-postings:CREATE` fica de fora: dar
    // entrada no estoque e assumir a conta a pagar move ativo e dinheiro, e é
    // decisão de quem confere a mercadoria e de quem paga, não de quem arquiva o
    // documento (RN-003). Junto vem a leitura do que a nota precisa referenciar:
    // fornecedor, catálogo e pedido.
    {
      role: 'FISCAL',
      codes: [
        ...PERMISSION_CATALOG.filter(
          (p) => p.module === 'M07' && p.code !== PERMISSIONS.FISCAL_POSTINGS_CREATE,
        ).map((p) => p.code),
        PERMISSIONS.PARTNERS_READ,
        PERMISSIONS.PRODUCTS_READ,
        PERMISSIONS.PRODUCT_SUPPLIERS_READ,
        PERMISSIONS.PURCHASE_ORDERS_READ,
        PERMISSIONS.GOODS_RECEIPTS_READ,
      ],
    },
    // M14: o planejamento é do Diretor (é ele o responsável pelos RF-101 a
    // RF-105). Junto vem a leitura da carteira, sem a qual a projeção é um
    // gráfico sem origem — e nada de escrita no M08: quem planeja o caixa não
    // lança nem baixa título.
    {
      role: 'DIRETOR',
      codes: [
        ...PERMISSION_CATALOG.filter((p) => p.module === 'M14').map((p) => p.code),
        PERMISSIONS.FINANCIAL_ENTRIES_READ,
        PERMISSIONS.SETTLEMENTS_READ,
        PERMISSIONS.DELINQUENCY_READ,
        // M09: o saldo em conta e as ordens em andamento são a parte do caixa
        // que já saiu do controle da carteira — leitura, nunca emissão.
        PERMISSIONS.COMPANY_BANK_ACCOUNTS_READ,
        PERMISSIONS.PAYMENTS_READ,
        PERMISSIONS.BANK_STATEMENTS_READ,
      ],
    },
    // Operacional cadastra e consulta o catálogo, movimenta e conta o estoque,
    // sem tocar em parceiros. Duas exclusões: concluir o inventário, pela mesma
    // razão do reembolso (RN-003) — quem conta não homologa a própria diferença,
    // e o ajuste escreve uma perda ou uma sobra direto no ativo; e a
    // valorização, que é a leitura financeira do mesmo saldo.
    {
      role: 'OPERACIONAL',
      codes: [
        ...PERMISSION_CATALOG.filter(
          (p) =>
            p.module === 'M05' &&
            p.code !== PERMISSIONS.INVENTORIES_APPROVE &&
            p.resource !== RESOURCES.STOCK_VALUATION,
        ).map((p) => p.code),
        // M06: quem recebe a mercadoria é quem confere — e não é quem a pediu
        // (RN-003). Sem o pedido à vista não há contra o que conferir, mas o
        // pedido em si é leitura: Operacional não negocia preço.
        PERMISSIONS.GOODS_RECEIPTS_CREATE,
        PERMISSIONS.GOODS_RECEIPTS_READ,
        PERMISSIONS.PURCHASE_ORDERS_READ,
        // M07: a conferência é contra a nota que veio com a carga (RF-047).
        PERMISSIONS.FISCAL_DOCUMENTS_READ,
      ],
    },
  ];

  for (const { role, codes } of grants) {
    // Perfis de sistema: `empresa_id` nulo, visíveis a todas as empresas.
    const profile = await prisma.role.findFirst({
      where: { name: role, companyId: null, isSystem: true },
      select: { id: true },
    });
    if (!profile) {
      console.warn(`! perfil de sistema ${role} não encontrado — rode bd/03.`);
      continue;
    }

    const wanted =
      codes === 'all'
        ? PERMISSION_CATALOG
        : PERMISSION_CATALOG.filter((p) => codes.includes(p.code));

    for (const p of wanted) {
      const permission = await prisma.permission.findUnique({
        where: {
          module_resource_action: { module: p.module, resource: p.resource, action: p.action },
        },
        select: { id: true },
      });
      if (!permission) continue;

      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: profile.id, permissionId: permission.id } },
        create: { roleId: profile.id, permissionId: permission.id },
        update: {},
      });
    }
    console.log(`✔ perfil ${role}: ${wanted.length} permissões da API vinculadas.`);
  }
}

async function seedAdmin(): Promise<void> {
  const email = (process.env.SEED_ADMIN_EMAIL ?? 'admin@sge.local').toLowerCase();
  const name = process.env.SEED_ADMIN_NAME ?? 'Administrador do Sistema';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!2026';

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    await prisma.user.update({
      where: { email },
      data: { name, isSuperAdmin: true, isActive: true },
    });
    console.log(`✔ Super admin já existente atualizado: ${email}`);
    return;
  }

  const passwordHash = await hash(password, ARGON2_OPTIONS);
  await prisma.user.create({
    data: { email, name, passwordHash, isSuperAdmin: true },
  });
  console.log(`✔ Super admin criado: ${email}`);
}

async function main(): Promise<void> {
  const [{ schema }] = await prisma.$queryRaw<
    { schema: string }[]
  >`SELECT current_schema() AS schema`;
  if (schema !== 'gestao') {
    throw new Error(
      `Conexão apontando para o schema "${schema}". Inclua ?schema=gestao na DATABASE_URL.`,
    );
  }
  await seedPermissions();
  await seedSystemRoles();
  await seedAdmin();
}

main()
  .catch((error) => {
    console.error('Falha no seed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
