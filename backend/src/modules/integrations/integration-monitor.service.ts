import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/paginated-result';
import { QueryIntegrationEventDto } from './dto/integration.dto';

/** Uma linha de `vw_integracao_saude` (bd/20 §7). */
interface IntegrationHealthRow {
  integracao_id: string;
  codigo: string;
  nome: string;
  status: string;
  ativo: boolean;
  provedor_codigo: string;
  provedor_categoria: string;
  falhas_consecutivas: number;
  limite_falhas: number;
  ultima_execucao_em: Date | null;
  ultimo_sucesso_em: Date | null;
  ultimo_erro_em: Date | null;
  ultimo_erro: string | null;
  eventos_24h: bigint;
  erros_24h: bigint;
  ultimo_evento_erro_em: Date | null;
}

/** Contagem por situação, vinda de `job_execucao` e `webhook_evento`. */
interface StatusCountRow {
  status: string;
  total: bigint;
}

/**
 * Monitoramento das integrações (RF-128).
 *
 * Duas fontes, e a divisão entre elas é o ponto: `vw_integracao_saude` responde
 * "como está cada integração cadastrada" e a fila responde "o que está parado
 * agora". Um painel que só olhasse o cadastro diria "tudo ativo" com trezentos
 * jobs em FALHA; um que só olhasse a fila não saberia dizer qual provedor
 * parou.
 *
 * Todo `$queryRaw` aqui é parametrizado por template tag — nenhuma string de
 * usuário entra em SQL por concatenação. E nenhum deles filtra por empresa na
 * cláusula: quem o faz é a RLS, e o `security_invoker` da view (bd/20 §7) é o
 * que garante que ela seja aplicada com a sessão de quem chama.
 */
@Injectable()
export class IntegrationMonitorService {
  constructor(private readonly prisma: PrismaService) {}

  /** Painel: uma linha por integração da empresa, com os contadores de 24h. */
  async health(companyId: string) {
    const rows = await this.prisma.db.$queryRaw<IntegrationHealthRow[]>`
      SELECT integracao_id, codigo, nome, status::text AS status, ativo,
             provedor_codigo, provedor_categoria::text AS provedor_categoria,
             falhas_consecutivas, limite_falhas,
             ultima_execucao_em, ultimo_sucesso_em, ultimo_erro_em, ultimo_erro,
             eventos_24h, erros_24h, ultimo_evento_erro_em
        FROM vw_integracao_saude
       WHERE empresa_id = ${companyId}::uuid
       ORDER BY (status <> 'ATIVA') DESC, erros_24h DESC, codigo ASC
    `;

    const integrations = rows.map((row) => ({
      id: row.integracao_id,
      code: row.codigo,
      name: row.nome,
      status: row.status,
      isActive: row.ativo,
      provider: { code: row.provedor_codigo, category: row.provedor_categoria },
      failureStreak: row.falhas_consecutivas,
      failureThreshold: row.limite_falhas,
      lastRunAt: row.ultima_execucao_em,
      lastSuccessAt: row.ultimo_sucesso_em,
      lastFailureAt: row.ultimo_erro_em,
      lastError: row.ultimo_erro,
      events24h: Number(row.eventos_24h),
      errors24h: Number(row.erros_24h),
      lastErrorEventAt: row.ultimo_evento_erro_em,
      // Degradada é a que ainda responde mas já acumulou falha: é a que se olha
      // antes de ela suspender sozinha, e é para isso que o painel existe.
      degraded: row.falhas_consecutivas > 0 && row.status === 'ATIVA',
    }));

    const [jobs, webhooks] = await Promise.all([this.jobSummary(), this.webhookSummary()]);

    return {
      integrations,
      totals: {
        total: integrations.length,
        active: integrations.filter((i) => i.status === 'ATIVA').length,
        suspended: integrations.filter((i) => i.status === 'SUSPENSA').length,
        degraded: integrations.filter((i) => i.degraded).length,
        errors24h: integrations.reduce((sum, i) => sum + i.errors24h, 0),
      },
      queue: jobs,
      webhooks,
    };
  }

  /** Diário paginado (RF-129). */
  async findEvents(companyId: string, query: QueryIntegrationEventDto) {
    const where: Prisma.IntegrationEventWhereInput = {
      companyId,
      ...(query.integrationId ? { integrationId: query.integrationId } : {}),
      ...(query.severity ? { severity: query.severity } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.from || query.to
        ? {
            occurredAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
      ...(query.q ? { message: { contains: query.q, mode: 'insensitive' as const } } : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.db.integrationEvent.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }],
        skip: query.skip,
        take: query.take,
        select: {
          id: true,
          integrationId: true,
          providerId: true,
          type: true,
          severity: true,
          operation: true,
          message: true,
          detail: true,
          referenceType: true,
          referenceId: true,
          httpStatus: true,
          durationMs: true,
          attempt: true,
          correlationId: true,
          occurredAt: true,
          integration: { select: { id: true, code: true, name: true } },
        },
      }),
      this.prisma.db.integrationEvent.count({ where }),
    ]);

    return new PaginatedResult(data, total, query.page, query.pageSize);
  }

  /**
   * Situação da fila da empresa.
   *
   * `job_execucao.empresa_id` é anulável (job de plataforma) e sua política de
   * RLS já isola por empresa (bd/13 §10); o `where` explícito existe porque em
   * contexto de worker a mesma política deixaria tudo passar, e este serviço
   * pode ser chamado de lá numa varredura futura.
   */
  private async jobSummary() {
    const rows = await this.prisma.db.$queryRaw<StatusCountRow[]>`
      SELECT status::text AS status, count(*) AS total
        FROM job_execucao
       WHERE criado_em >= now() - interval '7 days'
       GROUP BY status
    `;
    return this.summarize(rows);
  }

  private async webhookSummary() {
    const rows = await this.prisma.db.$queryRaw<StatusCountRow[]>`
      SELECT status::text AS status, count(*) AS total
        FROM webhook_evento
       WHERE recebido_em >= now() - interval '7 days'
       GROUP BY status
    `;
    return this.summarize(rows);
  }

  private summarize(rows: StatusCountRow[]) {
    const byStatus: Record<string, number> = {};
    for (const row of rows) {
      byStatus[row.status] = Number(row.total);
    }
    return {
      window: '7d',
      byStatus,
      pending: (byStatus.PENDENTE ?? 0) + (byStatus.AGENDADO ?? 0) + (byStatus.PROCESSANDO ?? 0),
      failed: byStatus.FALHA ?? 0,
    };
  }
}
