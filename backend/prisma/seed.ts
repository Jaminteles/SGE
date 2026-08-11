import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import { PERMISSION_CATALOG, PERMISSIONS } from '../src/common/authorization/permission-catalog';

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
