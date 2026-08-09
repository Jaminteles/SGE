import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import { PERMISSION_CATALOG } from '../src/common/authorization/permission-catalog';

const prisma = new PrismaClient();

const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };

async function seedPermissions(): Promise<void> {
  for (const p of PERMISSION_CATALOG) {
    await prisma.permission.upsert({
      where: { code: p.code },
      create: {
        code: p.code,
        module: p.module,
        resource: p.resource,
        action: p.action,
        description: p.description,
      },
      update: {
        module: p.module,
        resource: p.resource,
        action: p.action,
        description: p.description,
      },
    });
  }
  console.log(`✔ ${PERMISSION_CATALOG.length} permissões sincronizadas.`);
}

async function seedAdmin(): Promise<void> {
  const email = (process.env.SEED_ADMIN_EMAIL ?? 'admin@sge.local').toLowerCase();
  const name = process.env.SEED_ADMIN_NAME ?? 'Administrador do Sistema';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!2026';

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    await prisma.user.update({
      where: { email },
      data: { name, isSuperAdmin: true, status: 'ACTIVE' },
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
  await seedPermissions();
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
