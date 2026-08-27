import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaginatedResult } from '../../common/dto/paginated-result';
import { FiscalEventStatus, FiscalEventType } from '../../common/enums';
import { PrismaService } from '../../prisma/prisma.service';
import { FiscalDocumentsService } from '../fiscal-documents/fiscal-documents.service';
import {
  CreateFiscalEventDto,
  QueryFiscalEventDto,
  SettleFiscalEventDto,
} from './dto/fiscal-event.dto';
import {
  JUSTIFIED_EVENTS,
  MAX_EVENT_SEQUENCE,
  MIN_JUSTIFICATION_LENGTH,
  TRANSMITTABLE,
} from './fiscal.constants';

const eventSelect = {
  id: true,
  documentId: true,
  type: true,
  protocol: true,
  sequence: true,
  occurredAt: true,
  justification: true,
  status: true,
  response: true,
  createdAt: true,
} satisfies Prisma.FiscalEventSelect;

export type FiscalEventRow = Prisma.FiscalEventGetPayload<{ select: typeof eventSelect }>;

/**
 * Eventos fiscais do documento (RF-092).
 *
 * Cancelamento, carta de correção, manifestação e inutilização. O evento é
 * **prova do que foi declarado ao fisco**, e é isso que explica cada regra deste
 * serviço:
 *
 *  1. **nasce REGISTRADO, sem protocolo**. A API não aceita status nem protocolo
 *     na criação: qualquer chamada poderia, assim, declarar uma autorização que
 *     a SEFAZ nunca deu;
 *  2. **a sequência é única por documento e tipo**. Duas CC-e com a mesma
 *     sequência são duas versões do mesmo documento oficial, e não há como saber
 *     qual foi transmitida. A sequência omitida vira a próxima livre, e o índice
 *     único de bd/18 §6 é onde duas requisições simultâneas se encontram;
 *  3. **o corpo não muda e a linha não se apaga** (bd/18 §6). Só o transporte
 *     anda, e só para frente;
 *  4. **cancelamento autorizado cancela a nota** — pelo M07, com as travas dele:
 *     documento que já gerou estoque ou título não é cancelável aqui, porque
 *     desfazer isso é estorno no razão e cancelamento do título.
 *
 * O `xml_conteudo` do evento não é devolvido nas consultas de lista: é um campo
 * grande e raramente necessário fora da conferência pontual.
 */
@Injectable()
export class FiscalEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: FiscalDocumentsService,
  ) {}

  /** Registra o evento (RF-092). Registrar não transmite. */
  async create(companyId: string, dto: CreateFiscalEventDto): Promise<FiscalEventRow> {
    this.assertJustification(dto.type, dto.justification);

    if (dto.type === FiscalEventType.INUTILIZACAO) {
      if (dto.documentId) {
        throw new BadRequestException(
          'Inutilização se refere a faixa de numeração, não a um documento recebido.',
        );
      }
    } else {
      if (!dto.documentId) {
        throw new BadRequestException('Informe o documento fiscal do evento.');
      }
      // Confere a existência dentro da empresa; id de outra empresa é 404.
      await this.documents.findOne(companyId, dto.documentId);
    }

    return this.prisma.transaction(async () => {
      const sequence = dto.documentId
        ? (dto.sequence ?? (await this.nextSequence(companyId, dto.documentId, dto.type)))
        : dto.sequence;

      try {
        return await this.prisma.db.fiscalEvent.create({
          data: {
            companyId,
            documentId: dto.documentId,
            type: dto.type,
            sequence,
            justification: dto.justification,
            xmlContent: dto.xmlContent,
            status: FiscalEventStatus.REGISTRADO,
          },
          select: eventSelect,
        });
      } catch (error) {
        throw this.translateUniqueness(error);
      }
    });
  }

  async findAll(
    companyId: string,
    query: QueryFiscalEventDto,
  ): Promise<PaginatedResult<FiscalEventRow>> {
    const where: Prisma.FiscalEventWhereInput = {
      companyId,
      ...(query.documentId ? { documentId: query.documentId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.db.fiscalEvent.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }],
        skip: query.skip,
        take: query.take,
        select: eventSelect,
      }),
      this.prisma.db.fiscalEvent.count({ where }),
    ]);

    return new PaginatedResult(rows, total, query.page, query.pageSize);
  }

  /** Um evento da empresa ativa. Id de outra empresa é 404, não 403. */
  findOne(companyId: string, id: string): Promise<FiscalEventRow> {
    return this.findEntity(companyId, id);
  }

  /**
   * Lança a resposta do fisco (RF-092).
   *
   * É o caminho de quem transmite por fora — pelo emissor da contabilidade. O
   * mesmo método fecha o evento transmitido pelo provedor (RF-094): o retorno é
   * um só, venha de onde vier.
   */
  async settle(companyId: string, id: string, dto: SettleFiscalEventDto): Promise<FiscalEventRow> {
    if (dto.status !== FiscalEventStatus.AUTORIZADO && dto.status !== FiscalEventStatus.REJEITADO) {
      throw new BadRequestException(
        'A resposta do fisco é AUTORIZADO ou REJEITADO: o restante é transporte, não retorno.',
      );
    }

    const event = await this.findEntity(companyId, id);
    this.assertTransmittable(event);

    return this.applyResult(companyId, event.id, {
      status: dto.status,
      protocol: dto.protocol,
      response: { origem: 'MANUAL', mensagem: dto.message ?? null },
    });
  }

  /**
   * Grava o resultado do transporte (RF-092/RF-094).
   *
   * Único ponto de escrita de status, protocolo e retorno — usado pela baixa
   * manual e pelo worker de transmissão. Concentrar aqui é o que garante que a
   * transição proibida pelo banco (bd/18 §6) tenha uma mensagem só, que o
   * protocolo repetido de um retry seja reconhecido em vez de virar 500, e que o
   * cancelamento autorizado alcance a nota por um caminho só.
   */
  async applyResult(
    companyId: string,
    id: string,
    result: {
      status: FiscalEventStatus;
      protocol?: string | null;
      response?: Prisma.InputJsonValue;
    },
  ): Promise<FiscalEventRow> {
    return this.prisma.transaction(async () => {
      try {
        // O `status` no where é o que torna a gravação idempotente sob retry: o
        // evento que já teve resposta não é reescrito por uma segunda chegada.
        const updated = await this.prisma.db.fiscalEvent.updateMany({
          where: { id, companyId, status: { in: TRANSMITTABLE } },
          data: {
            status: result.status,
            ...(result.protocol !== undefined ? { protocol: result.protocol } : {}),
            ...(result.response !== undefined ? { response: result.response } : {}),
          },
        });

        if (updated.count === 0) {
          throw new ConflictException(
            'O evento já teve resposta do fisco: ela não é revista por nova tentativa.',
          );
        }
      } catch (error) {
        throw this.translateUniqueness(error);
      }

      const settled = await this.findEntity(companyId, id);
      await this.afterAuthorization(companyId, settled);
      return settled;
    });
  }

  /**
   * Cancelamento autorizado cancela a nota (RF-049/RF-092).
   *
   * Pelo serviço do M07, e não por UPDATE direto: é lá que estão as travas de
   * documento que já gerou estoque ou título, e a trilha do cancelamento.
   */
  private async afterAuthorization(companyId: string, event: FiscalEventRow): Promise<void> {
    if (
      event.status !== FiscalEventStatus.AUTORIZADO ||
      event.type !== FiscalEventType.CANCELAMENTO ||
      !event.documentId
    ) {
      return;
    }

    await this.documents.cancel(companyId, event.documentId, {
      reason: `Cancelamento autorizado pelo fisco. Protocolo ${event.protocol ?? '—'}. ${
        event.justification ?? ''
      }`.trim(),
    });
  }

  /** Próxima sequência livre daquele tipo de evento no documento (RF-092). */
  private async nextSequence(
    companyId: string,
    documentId: string,
    type: FiscalEventType,
  ): Promise<number> {
    const last = await this.prisma.db.fiscalEvent.findFirst({
      where: { companyId, documentId, type },
      orderBy: { sequence: 'desc' },
      select: { sequence: true },
    });

    const next = (last?.sequence ?? 0) + 1;
    if (next > MAX_EVENT_SEQUENCE) {
      throw new ConflictException(
        `O documento já tem ${MAX_EVENT_SEQUENCE} eventos do tipo ${type}: o layout da SEFAZ não prevê mais.`,
      );
    }
    return next;
  }

  private assertJustification(type: FiscalEventType, justification?: string): void {
    if (!JUSTIFIED_EVENTS.includes(type)) {
      return;
    }
    if (!justification || justification.trim().length < MIN_JUSTIFICATION_LENGTH) {
      throw new BadRequestException(
        `${type} exige justificativa de pelo menos ${MIN_JUSTIFICATION_LENGTH} caracteres: é a única resposta que sobra depois.`,
      );
    }
  }

  private assertTransmittable(event: FiscalEventRow): void {
    if (!TRANSMITTABLE.includes(event.status as FiscalEventStatus)) {
      throw new ConflictException(
        `O evento está ${event.status}: a resposta do fisco não é revista por nova tentativa.`,
      );
    }
  }

  private async findEntity(companyId: string, id: string): Promise<FiscalEventRow> {
    const event = await this.prisma.db.fiscalEvent.findFirst({
      where: { id, companyId },
      select: eventSelect,
    });
    if (!event) {
      throw new NotFoundException('Evento fiscal não encontrado.');
    }
    return event;
  }

  /**
   * Os índices únicos viram mensagem, não 500.
   *
   * `ux_evento_fiscal_protocolo` é o que impede o retry do job de transformar uma
   * autorização em duas: o mesmo protocolo em dois eventos seria uma resposta do
   * fisco que nunca existiu.
   */
  private translateUniqueness(error: unknown): Error {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const target = String(error.meta?.target ?? '');
      if (target.includes('protocolo')) {
        return new ConflictException('Este protocolo já está registrado em outro evento fiscal.');
      }
      return new ConflictException(
        'Já existe um evento deste tipo com esta sequência para o documento.',
      );
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}
