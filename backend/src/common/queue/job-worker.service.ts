import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { JobRegistry } from './job-registry.service';
import { JobContext, PermanentJobError } from './job.types';

/** Uma linha reivindicada de `gestao.job_execucao`. */
interface ClaimedJob {
  id: string;
  empresa_id: string | null;
  fila: string;
  nome: string;
  payload: Record<string, unknown>;
  tentativas: number;
  max_tentativas: number;
  correlation_id: string | null;
}

/**
 * Runner da fila (RF-069/RF-070, RNF-009/RNF-013).
 *
 * Três propriedades, e cada uma resolve um modo de falha concreto:
 *
 *  1. **reivindicação atômica** — `FOR UPDATE SKIP LOCKED` faz N processos
 *     competirem pela mesma fila sem nunca pegarem o mesmo job. É o que permite
 *     escalar o worker separado da API (`WORKER_ENABLED=false` na API,
 *     `true` no processo de fila), sem coordenação externa;
 *  2. **efeito e conclusão no mesmo commit** — o handler roda dentro da
 *     transação que marca o job como concluído. Um pagamento enviado cujo job
 *     ficou PENDENTE seria reenviado; aqui isso não existe;
 *  3. **retry com backoff exponencial e teto** — falha transitória volta para a
 *     fila; `PermanentJobError` e o esgotamento das tentativas param em FALHA,
 *     que é a fila morta para inspeção.
 *
 * O `setTimeout` que se reagenda (e não `setInterval`) garante que uma rodada
 * lenta não sobreponha a seguinte.
 */
@Injectable()
export class JobWorkerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(JobWorkerService.name);
  private readonly enabled: boolean;
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;
  private readonly backoffBaseMs: number;
  private readonly backoffMaxMs: number;

  private timer?: NodeJS.Timeout;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: JobRegistry,
    config: ConfigService,
  ) {
    this.enabled = config.get<boolean>('WORKER_ENABLED') ?? true;
    this.pollIntervalMs = config.get<number>('WORKER_POLL_INTERVAL_MS') ?? 5_000;
    this.batchSize = config.get<number>('WORKER_BATCH_SIZE') ?? 5;
    this.backoffBaseMs = config.get<number>('JOB_BACKOFF_BASE_MS') ?? 30_000;
    this.backoffMaxMs = config.get<number>('JOB_BACKOFF_MAX_MS') ?? 3_600_000;
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) {
      this.logger.log('Worker de filas desabilitado neste processo (WORKER_ENABLED=false).');
      return;
    }
    this.schedule(0);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
    }
  }

  /** Uma rodada: reivindica e executa até `batchSize` jobs. Exposta para teste. */
  async runOnce(): Promise<number> {
    let processed = 0;
    for (let i = 0; i < this.batchSize; i += 1) {
      const job = await this.claim();
      if (!job) break;
      await this.execute(job);
      processed += 1;
    }
    return processed;
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.tick();
    }, delayMs);
    // Não segura o processo vivo só por causa do polling.
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    try {
      const processed = await this.runOnce();
      // Fila com trabalho: volta imediatamente, sem esperar o intervalo.
      this.schedule(processed === this.batchSize ? 0 : this.pollIntervalMs);
    } catch (error) {
      this.logger.error(`Falha na rodada do worker: ${String(error)}`);
      this.schedule(this.pollIntervalMs);
    }
  }

  /**
   * Reivindica o próximo job vencido. O `UPDATE ... WHERE id = (SELECT ... FOR
   * UPDATE SKIP LOCKED)` é uma única instrução: o job sai da fila e entra em
   * PROCESSANDO no mesmo commit, e nenhum outro worker o enxerga no caminho.
   */
  private async claim(): Promise<ClaimedJob | null> {
    return this.prisma.runAsSystem({ origin: 'WORKER' }, async () => {
      const rows = await this.prisma.db.$queryRaw<ClaimedJob[]>`
        UPDATE job_execucao
           SET status      = 'PROCESSANDO',
               iniciado_em = now(),
               tentativas  = tentativas + 1
         WHERE id = (
               SELECT id
                 FROM job_execucao
                WHERE status IN ('PENDENTE','AGENDADO')
                  AND (agendado_para IS NULL OR agendado_para <= now())
                  AND tentativas < max_tentativas
                ORDER BY agendado_para NULLS FIRST, criado_em
                   FOR UPDATE SKIP LOCKED
                LIMIT 1)
        RETURNING id, empresa_id, fila, nome, payload, tentativas, max_tentativas, correlation_id
      `;
      return rows[0] ?? null;
    });
  }

  private async execute(job: ClaimedJob): Promise<void> {
    const handler = this.registry.get(job.nome);
    if (!handler) {
      // Handler ausente neste processo: não é falha do job, e sim deploy fora
      // de sincronia. Devolve para a fila em vez de queimar a tentativa.
      await this.release(job, `Nenhum handler registrado para ${job.nome} neste processo.`, true);
      return;
    }

    const context: JobContext = {
      jobId: job.id,
      companyId: job.empresa_id ?? undefined,
      attempt: job.tentativas,
      maxAttempts: job.max_tentativas,
      correlationId: job.correlation_id ?? undefined,
    };

    try {
      await this.prisma.runAsSystem(
        {
          origin: 'WORKER',
          companyId: job.empresa_id ?? undefined,
          correlationId: job.correlation_id ?? undefined,
        },
        async () => {
          await handler.handle(job.payload ?? {}, context);
          // Mesmo commit do efeito: o job só fica concluído se o trabalho ficou.
          await this.prisma.db.jobExecution.update({
            where: { id: job.id },
            data: { status: 'CONCLUIDO', finishedAt: new Date(), error: null },
          });
        },
      );
    } catch (error) {
      await this.fail(job, error);
    }
  }

  /** Falha do handler: reagenda com backoff ou encerra em FALHA (RF-070). */
  private async fail(job: ClaimedJob, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const permanent = error instanceof PermanentJobError;
    const exhausted = job.tentativas >= job.max_tentativas;

    if (permanent || exhausted) {
      this.logger.error(
        `Job ${job.nome} (${job.id}) encerrado em FALHA na tentativa ${job.tentativas}: ${message}`,
      );
      await this.finishAsFailed(job.id, message);
      return;
    }

    const delayMs = this.backoffFor(job.tentativas);
    this.logger.warn(
      `Job ${job.nome} (${job.id}) falhou na tentativa ${job.tentativas}/${job.max_tentativas}; ` +
        `nova tentativa em ${Math.round(delayMs / 1000)}s: ${message}`,
    );
    await this.release(job, message, false, delayMs);
  }

  private async finishAsFailed(jobId: string, message: string): Promise<void> {
    await this.prisma.runAsSystem({ origin: 'WORKER' }, async () => {
      await this.prisma.db.jobExecution.update({
        where: { id: jobId },
        data: {
          status: 'FALHA',
          error: message.slice(0, 2000),
          lastErrorAt: new Date(),
          finishedAt: new Date(),
        },
      });
    });
  }

  /** Devolve o job à fila. `keepAttempt` desconta a tentativa consumida. */
  private async release(
    job: ClaimedJob,
    message: string,
    keepAttempt: boolean,
    delayMs = this.pollIntervalMs,
  ): Promise<void> {
    await this.prisma.runAsSystem({ origin: 'WORKER' }, async () => {
      // `tentativas` não retrocede (bd/13 §8): quando a tentativa não foi de
      // verdade, o que se concede é uma tentativa a mais no teto.
      const maxAttempts = keepAttempt ? job.max_tentativas + 1 : undefined;
      await this.prisma.db.jobExecution.update({
        where: { id: job.id },
        data: {
          status: 'AGENDADO',
          scheduledFor: new Date(Date.now() + delayMs),
          error: message.slice(0, 2000),
          lastErrorAt: new Date(),
          startedAt: null,
          ...(maxAttempts ? { maxAttempts } : {}),
        },
      });
    });
  }

  /**
   * Backoff exponencial com meio-jitter: `base * 2^(n-1)`, no teto configurado,
   * sorteado entre 50% e 100% do valor. O jitter existe para que N jobs que
   * falharam pela mesma indisponibilidade não voltem todos no mesmo instante.
   */
  private backoffFor(attempt: number): number {
    const exponential = Math.min(this.backoffBaseMs * 2 ** (attempt - 1), this.backoffMaxMs);
    return Math.round(exponential * (0.5 + Math.random() * 0.5));
  }
}
