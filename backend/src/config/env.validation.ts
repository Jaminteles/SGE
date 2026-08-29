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

  // Segredos de integração (M09) são cifrados com AES-256-GCM: 32 bytes em
  // base64. Fora de produção há um valor de desenvolvimento para que o boot não
  // exija configuração; em produção a ausência derruba o boot, que é o correto
  // — subir a API sem chave significaria não conseguir ler nenhuma credencial
  // já gravada (RNF-003).
  INTEGRATION_ENCRYPTION_KEY: z
    .string()
    .refine((value) => Buffer.from(value, 'base64').length === 32, {
      message: 'INTEGRATION_ENCRYPTION_KEY deve ser 32 bytes codificados em base64',
    })
    .default('ZGV2LW9ubHkta2V5LWNoYW5nZS1tZS0zMmJ5dGVzISE='),

  // Provedores financeiros (RF-061).
  INTEGRATION_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().max(60_000).default(10_000),
  /** Allowlist de hosts das integrações (SSRF). Vazio = só o piso de rede privada. */
  INTEGRATION_ALLOWED_HOSTS: z.string().default(''),
  INTEGRATION_CIRCUIT_THRESHOLD: z.coerce.number().int().positive().default(5),
  INTEGRATION_CIRCUIT_OPEN_MS: z.coerce.number().int().positive().default(60_000),

  // Fila (RF-069/RF-070). `WORKER_ENABLED=false` sobe o processo só como API;
  // a mesma imagem com `true` e sem `PORT` exposta é o worker (RNF-009).
  // `z.coerce.boolean()` não serve aqui: a string "false" é truthy e viraria
  // `true`, ligando o worker justamente onde se pediu para desligá-lo.
  WORKER_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5_000),
  WORKER_BATCH_SIZE: z.coerce.number().int().positive().max(100).default(5),
  JOB_BACKOFF_BASE_MS: z.coerce.number().int().positive().default(30_000),
  JOB_BACKOFF_MAX_MS: z.coerce.number().int().positive().default(3_600_000),

  // Interface do Swagger (RF-131). A especificacao OpenAPI sai sempre por rota
  // autenticada; a UI e publica, e por isso o padrao (quando a variavel nao e
  // informada) e ligada fora de producao e desligada em producao -- o mesmo
  // comportamento de antes, agora explicitavel. Fica como string, e nao boolean:
  // 'ausente' e 'false' precisam ser distinguiveis para que o padrao por ambiente
  // funcione, e z.coerce.boolean() transformaria a string 'false' em true.
  SWAGGER_UI_ENABLED: z.enum(['true', 'false']).optional(),

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
