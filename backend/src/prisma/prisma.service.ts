import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Prisma, PrismaClient } from '@prisma/client';

/** Cliente sem `$transaction`/`$connect` — o que uma transação interativa expõe. */
export type TxClient = Prisma.TransactionClient;

interface RequestStore {
  tx: TxClient;
  companyId?: string;
  userId?: string;
  userName?: string;
  metadata?: RequestMetadata;
}

/**
 * Origem da ação, gravada em `auditoria.origem` (RF-115). Os valores seguem o
 * comentário da coluna em bd/03.
 */
export type AuditOrigin = 'API' | 'WORKER' | 'WEBHOOK' | 'IMPORTACAO' | 'SISTEMA';

/** Metadados da requisição que alimentam a trilha de auditoria (RF-115). */
export interface RequestMetadata {
  origin: AuditOrigin;
  ip?: string;
  userAgent?: string;
  correlationId?: string;
}

/**
 * Cliente Prisma + contexto de tenant da requisição.
 *
 * O isolamento multiempresa é feito por RLS no banco (bd/03, RN-001/RN-002):
 * as políticas comparam `empresa_id` com `current_setting('app.empresa_id')`.
 * Como `SET LOCAL` só vale dentro de uma transação, cada requisição roda em uma
 * transação interativa (aberta pelo TenantContextMiddleware) guardada em
 * AsyncLocalStorage. Os services acessam o banco por `prisma.db`, que devolve
 * a transação corrente — ou o cliente base, fora de uma requisição (seed, CLI).
 *
 * Sem esse contexto, toda tabela com `empresa_id` retorna zero linhas: o owner
 * do schema também está sujeito às políticas (FORCE ROW LEVEL SECURITY).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly als = new AsyncLocalStorage<RequestStore>();
  private readonly txTimeoutMs: number;

  constructor(private readonly config: ConfigService) {
    super();
    this.txTimeoutMs = Number(this.config.get('REQUEST_TX_TIMEOUT_MS') ?? 20_000);
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Acesso ao banco no contexto da requisição (transação com RLS aplicada). */
  get db(): TxClient {
    return this.als.getStore()?.tx ?? (this as unknown as TxClient);
  }

  /**
   * Cliente base, fora da transação da requisição.
   *
   * Use apenas quando o registro precisa sobreviver ao rollback — é o caso dos
   * eventos de segurança (RF-114): a transação da requisição é revertida em
   * resposta 4xx/5xx, e uma tentativa de acesso negado que some da trilha é
   * exatamente a que mais importa registrar.
   */
  get root(): PrismaClient {
    return this;
  }

  /** Empresa ativa da requisição, quando já resolvida pelo PermissionsGuard. */
  get currentCompanyId(): string | undefined {
    return this.als.getStore()?.companyId;
  }

  /** Usuário autenticado da requisição, quando já resolvido pelo JwtStrategy. */
  get currentUser(): { id: string; name?: string } | undefined {
    const store = this.als.getStore();
    return store?.userId ? { id: store.userId, name: store.userName } : undefined;
  }

  /**
   * Metadados HTTP da requisição corrente.
   *
   * Os parâmetros de sessão (`app.*`) só alcançam a trilha nas gravações feitas
   * por trigger. Um INSERT direto em `auditoria` — como o dos eventos de
   * negócio — precisa preencher as colunas, e é daqui que os valores vêm.
   */
  get currentRequestMetadata(): RequestMetadata | undefined {
    return this.als.getStore()?.metadata;
  }

  /**
   * Abre a transação da requisição e mantém o contexto até `release` ser
   * chamado. Retorna uma função de encerramento: `commit`/`rollback`.
   */
  async openRequestContext(): Promise<{
    run: <T>(fn: () => T) => T;
    end: (commit: boolean) => Promise<void>;
  }> {
    let store!: RequestStore;
    let finish!: (commit: boolean) => void;
    let ready!: () => void;
    let failed!: (error: unknown) => void;

    const started = new Promise<void>((resolve, reject) => {
      ready = resolve;
      failed = reject;
    });

    // A transação vive enquanto a promessa interna não é resolvida/rejeitada.
    const running = this.$transaction(
      async (tx) => {
        store = { tx };
        ready();
        await new Promise<void>((resolve, reject) => {
          finish = (commit) => (commit ? resolve() : reject(new RollbackSignal()));
        });
      },
      { timeout: this.txTimeoutMs, maxWait: this.txTimeoutMs },
    );

    // Nunca deixa a promessa sem tratamento (rollback é fluxo esperado).
    const settled = running.catch((error: unknown) => {
      if (!(error instanceof RollbackSignal)) {
        this.logger.warn(`Transação da requisição encerrada com erro: ${String(error)}`);
      }
      // Se falhou antes de abrir (banco fora, pool esgotado), libera quem espera.
      failed(error);
    });

    await started;

    return {
      run: <T>(fn: () => T): T => this.als.run(store, fn),
      end: async (commit: boolean) => {
        finish(commit);
        await settled;
      },
    };
  }

  /**
   * Define o usuário da sessão de banco (`app.usuario_id`), usado pela auditoria
   * (RN-010) e pelas políticas de leitura das próprias associações.
   *
   * O nome é desnormalizado na trilha (RF-115): o registro precisa continuar
   * legível depois que o usuário for renomeado ou removido.
   */
  async setCurrentUser(userId: string, userName?: string): Promise<void> {
    const store = this.als.getStore();
    if (!store) return;
    store.userId = userId;
    store.userName = userName;
    await this.db.$queryRaw`
      SELECT set_config('app.usuario_id', ${userId}, true),
             set_config('app.usuario_nome', ${userName ?? ''}, true)
    `;
  }

  /**
   * Publica os metadados da requisição na sessão de banco (RF-115).
   *
   * O trigger de auditoria roda dentro do PostgreSQL e não enxerga o HTTP:
   * é por estes parâmetros que ip, user agent e correlation id chegam à trilha
   * (bd/05, fn_auditoria_generica).
   */
  async setRequestMetadata(meta: RequestMetadata): Promise<void> {
    const store = this.als.getStore();
    if (!store) return;
    store.metadata = meta;
    // Um único round-trip: são quatro parâmetros em toda requisição, e a
    // latência de rede aqui entra no caminho crítico de cada chamada da API.
    await this.db.$queryRaw`
      SELECT set_config('app.origem', ${meta.origin}, true),
             set_config('app.ip', ${meta.ip ?? ''}, true),
             set_config('app.user_agent', ${meta.userAgent ?? ''}, true),
             set_config('app.correlation_id', ${meta.correlationId ?? ''}, true)
    `;
  }

  /** Define a empresa ativa da sessão de banco (`app.empresa_id`) — RF-005. */
  async setCurrentCompany(companyId: string): Promise<void> {
    const store = this.als.getStore();
    if (!store) return;
    store.companyId = companyId;
    await this.applySetting('app.empresa_id', companyId);
  }

  /**
   * Executa `fn` com a empresa `companyId` no contexto de banco e restaura o
   * valor anterior ao final. Necessário quando um super admin opera sobre uma
   * empresa recém-criada (ex.: provisionar o perfil administrador).
   */
  async withCompany<T>(companyId: string, fn: () => Promise<T>): Promise<T> {
    const store = this.als.getStore();
    const previous = store?.companyId;
    await this.setCurrentCompany(companyId);
    try {
      return await fn();
    } finally {
      if (store) {
        store.companyId = previous;
        await this.applySetting('app.empresa_id', previous ?? '');
      }
    }
  }

  /**
   * Executa `fn` em transação. Dentro de uma requisição reaproveita a transação
   * já aberta (Postgres não tem transações aninhadas reais).
   */
  async transaction<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
    const store = this.als.getStore();
    if (store) {
      return fn(store.tx);
    }
    return this.$transaction((tx) => fn(tx), { timeout: this.txTimeoutMs });
  }

  private async applySetting(key: string, value: string): Promise<void> {
    // `true` = SET LOCAL: o valor morre junto com a transação da requisição.
    await this.db.$queryRaw`SELECT set_config(${key}, ${value}, true)`;
  }
}

/** Sinaliza rollback da transação da requisição sem virar erro de aplicação. */
class RollbackSignal extends Error {
  constructor() {
    super('rollback');
    this.name = 'RollbackSignal';
  }
}
