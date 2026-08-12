import { Injectable, Logger } from '@nestjs/common';
import { AuditEvent, Prisma } from '@prisma/client';
import { PrismaService, TxClient } from '../../prisma/prisma.service';

/** Entidade referida pelo evento — o nome da tabela em `gestao` (RF-115). */
export const AUDIT_ENTITY = {
  USER: 'usuario',
  SESSION: 'sessao',
  COMPANY: 'empresa',
  EMPLOYEE: 'funcionario',
  REIMBURSEMENT: 'reembolso',
} as const;

export interface AuditEventInput {
  event: AuditEvent;
  /** Tabela de `gestao` a que o evento se refere. */
  entity: string;
  entityId?: string;
  /** Padrão: a empresa ativa da requisição. */
  companyId?: string;
  /** Informe quando o evento ocorre antes de a sessão de banco ter dono. */
  userId?: string;
  userName?: string;
  note?: string;
  previousValue?: Prisma.InputJsonValue;
  currentValue?: Prisma.InputJsonValue;
}

/** Subconjunto do cliente Prisma usado aqui — serve tanto à transação quanto ao base. */
type AuditWriter = Pick<TxClient, 'auditLog'>;

/**
 * Registro dos eventos de negócio na trilha de auditoria (RF-114).
 *
 * Divisão de responsabilidade com o banco: criação, alteração e exclusão já são
 * capturadas pelo trigger de DML (bd/03) — não as duplique aqui. Este serviço
 * cobre o que não tem DML própria que o represente: login, logout, acesso
 * negado, aprovação, pagamento, recebimento e cancelamento.
 *
 * A trilha é append-only: não existe método de alteração ou remoção, e o banco
 * também os recusa (bd/03 por trigger, bd/05 por privilégio) — RF-118.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registra um evento dentro da transação da requisição.
   *
   * O evento segue o destino da operação auditada: se a requisição falhar e
   * reverter, ele some junto — o correto para algo que não chegou a acontecer.
   */
  async record(input: AuditEventInput): Promise<void> {
    await this.write(this.prisma.db, input);
  }

  /**
   * Registra um evento fora da transação da requisição.
   *
   * Para eventos de segurança, que precisam persistir mesmo quando a resposta é
   * de erro: o TenantContextMiddleware reverte a transação em respostas 4xx/5xx,
   * e uma tentativa de acesso com credencial inválida é justamente a que não
   * pode desaparecer da trilha.
   *
   * Nunca propaga exceção — auditar é efeito colateral, e uma falha aqui não
   * pode transformar um 401 legítimo em 500.
   */
  async recordOutOfBand(input: AuditEventInput): Promise<void> {
    try {
      await this.write(this.prisma.root, input);
    } catch (error) {
      this.logger.error(`Falha ao registrar ${input.event} em ${input.entity}: ${String(error)}`);
    }
  }

  private async write(client: AuditWriter, input: AuditEventInput): Promise<void> {
    const meta = this.prisma.currentRequestMetadata;
    const user = this.prisma.currentUser;

    // `createMany` — e não `create` — porque `create` emite INSERT ... RETURNING,
    // e o RETURNING é submetido à política de SELECT da trilha, que é estrita
    // (`empresa_id = fn_empresa_corrente()`, bd/05). Um evento de plataforma
    // (login, logout: `empresa_id` nulo) nunca satisfaz essa condição e o INSERT
    // era recusado com 42501, derrubando a requisição inteira.
    //
    // Enfraquecer a política de leitura para devolver a linha seria pagar
    // isolamento por um dado que ninguém usa: a trilha é append-only e nenhum
    // chamador precisa do registro de volta.
    await client.auditLog.createMany({
      data: {
        event: input.event,
        entity: input.entity,
        entityId: input.entityId,
        companyId: input.companyId ?? this.prisma.currentCompanyId,
        userId: input.userId ?? user?.id,
        userName: input.userName ?? user?.name,
        note: input.note,
        previousValue: input.previousValue,
        currentValue: input.currentValue,
        // Um INSERT direto não passa pelo trigger: as colunas de origem
        // (RF-115) precisam ser preenchidas aqui.
        origin: meta?.origin ?? 'API',
        ip: meta?.ip,
        userAgent: meta?.userAgent,
        correlationId: meta?.correlationId,
      },
    });
  }
}
