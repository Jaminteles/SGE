import { z } from 'zod';

/**
 * Validação e tipagem das variáveis de ambiente (RNF-003).
 * Falha rápido no boot se algo obrigatório estiver ausente/ inválido.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória'),

  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET deve ter ao menos 16 caracteres'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET deve ter ao menos 16 caracteres'),
  JWT_REFRESH_TTL: z.string().default('7d'),

  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().positive().default(30),

  // Tempo máximo da transação que carrega o contexto de RLS de cada requisição.
  REQUEST_TX_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),

  CORS_ORIGINS: z.string().default(''),

  // Comprovantes de despesa (RF-019). Diretório fora do versionamento; em
  // produção troque o provedor por S3 sem mudar o contrato de `documento`.
  STORAGE_LOCAL_ROOT: z.string().default('./storage'),
  UPLOAD_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .max(50 * 1024 * 1024)
    .default(10 * 1024 * 1024),

  THROTTLE_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(120),

  SEED_ADMIN_EMAIL: z.string().email().default('admin@sge.local'),
  SEED_ADMIN_PASSWORD: z.string().min(10).default('ChangeMe!2026'),
  SEED_ADMIN_NAME: z.string().default('Administrador do Sistema'),
});

export type Env = z.infer<typeof envSchema>;

/** Usada pelo ConfigModule para validar o ambiente no carregamento. */
export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Variáveis de ambiente inválidas:\n${issues}`);
  }
  return parsed.data;
}
