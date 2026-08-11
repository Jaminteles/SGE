import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/paginated-result';
import { QueryAuditDto } from './dto/query-audit.dto';

/** Linha da trilha como a API a expõe. */
export interface AuditEntryResponse {
  id: string;
  event: string;
  entity: string;
  entityId: string | null;
  userId: string | null;
  userName: string | null;
  previousValue: Prisma.JsonValue;
  currentValue: Prisma.JsonValue;
  changedFields: string[];
  origin: string | null;
  ip: string | null;
  userAgent: string | null;
  correlationId: string | null;
  note: string | null;
  occurredAt: Date;
}

/**
 * Consulta da trilha de auditoria (RF-117) — `gestao.auditoria`.
 *
 * Somente leitura, por definição do requisito (RF-118): não há create, update
 * nem delete. A escrita de eventos é do AuditService (common/audit).
 *
 * O filtro por empresa é aplicado sempre e não vem do cliente: a RLS de bd/05 é
 * a segunda barreira, não a primeira.
 */
@Injectable()
export class AuditQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    companyId: string,
    query: QueryAuditDto,
  ): Promise<PaginatedResult<AuditEntryResponse>> {
    if (query.from && query.to && query.from > query.to) {
      throw new BadRequestException('O início do período não pode ser posterior ao fim.');
    }

    const where = this.buildWhere(companyId, query);

    const [rows, total] = await Promise.all([
      this.prisma.db.auditLog.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.db.auditLog.count({ where }),
    ]);

    return new PaginatedResult(
      rows.map((row) => this.toResponse(row)),
      total,
      query.page,
      query.pageSize,
    );
  }

  /**
   * Trilha completa de um registro, do mais recente ao mais antigo (RF-117).
   * Entidade e id vêm da rota e sobrescrevem o que tenha vindo na query.
   */
  findByEntity(
    companyId: string,
    entity: string,
    entityId: string,
    query: QueryAuditDto,
  ): Promise<PaginatedResult<AuditEntryResponse>> {
    return this.findAll(companyId, Object.assign(new QueryAuditDto(), query, { entity, entityId }));
  }

  /**
   * Detalha um evento. A chave primária no banco é composta (id, ocorrido_em)
   * por causa do particionamento; para a API basta o id, único na prática.
   */
  async findOne(companyId: string, id: string): Promise<AuditEntryResponse> {
    let auditId: bigint;
    try {
      auditId = BigInt(id);
    } catch {
      throw new BadRequestException('Identificador de evento inválido.');
    }

    const row = await this.prisma.db.auditLog.findFirst({
      where: { id: auditId, companyId },
    });
    if (!row) {
      throw new NotFoundException('Evento de auditoria não encontrado.');
    }
    return this.toResponse(row);
  }

  private buildWhere(companyId: string, query: QueryAuditDto): Prisma.AuditLogWhereInput {
    return {
      companyId,
      ...(query.event ? { event: query.event } : {}),
      ...(query.entity ? { entity: query.entity } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.from || query.to
        ? {
            occurredAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lt: query.to } : {}),
            },
          }
        : {}),
    };
  }

  /** `id` é bigint no banco e JSON.stringify não serializa BigInt: vai como string. */
  private toResponse(row: Prisma.AuditLogGetPayload<object>): AuditEntryResponse {
    return {
      id: row.id.toString(),
      event: row.event,
      entity: row.entity,
      entityId: row.entityId,
      userId: row.userId,
      userName: row.userName,
      previousValue: row.previousValue,
      currentValue: row.currentValue,
      changedFields: row.changedFields,
      origin: row.origin,
      ip: row.ip,
      userAgent: row.userAgent,
      correlationId: row.correlationId,
      note: row.note,
      occurredAt: row.occurredAt,
    };
  }
}
