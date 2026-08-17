import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntryType, Periodicity, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { PaginatedResult } from '../../common/dto/paginated-result';
import { ReferencesService } from '../../common/references/references.service';
import { formatDateOnly, toDateOnly } from '../../common/utils/date-only';
import { ENTRY_ORIGIN, FinancialEntriesService } from './financial-entries.service';
import { CreateRecurrenceDto } from './dto/create-recurrence.dto';
import { UpdateRecurrenceDto } from './dto/update-recurrence.dto';
import { GenerateRecurrenceDto } from './dto/generate-recurrence.dto';

/** Teto de títulos criados numa chamada — ver `generate`. */
const MAX_ENTRIES_PER_RUN = 60;

const recurrenceInclude = {
  partner: { select: { id: true, legalName: true } },
  category: { select: { id: true, code: true, name: true, type: true } },
  costCenter: { select: { id: true, code: true, name: true } },
} satisfies Prisma.RecurrenceInclude;

type RecurrenceRow = Prisma.RecurrenceGetPayload<{ include: typeof recurrenceInclude }>;

/**
 * Recorrências (RF-053) — `gestao.recorrencia`.
 *
 * Aluguel, mensalidade e assinatura são o mesmo contrato repetido: guardar o
 * molde evita redigitar (e redigitar errado) todo mês. A geração é **explícita**
 * — não há job silencioso criando títulos: cada rodada tem um usuário
 * responsável, que é o que a trilha precisa registrar (RF-115).
 *
 * A data da próxima ocorrência é calculada pelo banco (`fn_proxima_ocorrencia`),
 * porque é lá que "todo dia 31" precisa saber o que fazer em fevereiro.
 */
@Injectable()
export class RecurrencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly references: ReferencesService,
    private readonly entries: FinancialEntriesService,
  ) {}

  async create(companyId: string, dto: CreateRecurrenceDto) {
    await this.assertReferences(companyId, dto.type, dto);

    const startDate = toDateOnly(dto.startDate);
    const endDate = dto.endDate ? toDateOnly(dto.endDate) : null;
    if (endDate && endDate < startDate) {
      throw new BadRequestException('O fim da recorrência não pode ser anterior ao início.');
    }

    const created = await this.prisma.db.recurrence.create({
      data: {
        companyId,
        description: dto.description,
        type: dto.type,
        periodicity: dto.periodicity,
        startDate,
        endDate,
        dueDay: dto.dueDay,
        maxOccurrences: dto.maxOccurrences,
        defaultAmount: dto.defaultAmount != null ? new Prisma.Decimal(dto.defaultAmount) : null,
        partnerId: dto.partnerId,
        categoryId: dto.categoryId,
        costCenterId: dto.costCenterId,
        // A primeira geração é o próprio início: sem isso, uma recorrência
        // criada hoje para começar hoje não geraria nada até a rodada seguinte.
        nextRunDate: startDate,
      },
      select: { id: true },
    });

    return this.findOne(companyId, created.id);
  }

  async findAll(companyId: string, query: PaginationQueryDto) {
    const where: Prisma.RecurrenceWhereInput = {
      companyId,
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.q ? { description: { contains: query.q, mode: 'insensitive' } } : {}),
    };

    const data = await this.prisma.db.recurrence.findMany({
      where,
      include: recurrenceInclude,
      orderBy: [{ isActive: 'desc' }, { nextRunDate: 'asc' }],
      skip: query.skip,
      take: query.take,
    });
    const total = await this.prisma.db.recurrence.count({ where });

    return new PaginatedResult(data, total, query.page, query.pageSize);
  }

  async findOne(companyId: string, id: string): Promise<RecurrenceRow> {
    const recurrence = await this.prisma.db.recurrence.findFirst({
      where: { id, companyId },
      include: recurrenceInclude,
    });
    if (!recurrence) {
      throw new NotFoundException('Recorrência não encontrada.');
    }
    return recurrence;
  }

  async update(companyId: string, id: string, dto: UpdateRecurrenceDto) {
    const current = await this.findOne(companyId, id);
    await this.assertReferences(companyId, current.type, dto);

    const endDate = dto.endDate ? toDateOnly(dto.endDate) : undefined;
    if (endDate && endDate < current.startDate) {
      throw new BadRequestException('O fim da recorrência não pode ser anterior ao início.');
    }

    await this.prisma.db.recurrence.update({
      where: { id },
      data: {
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(endDate ? { endDate } : {}),
        ...(dto.dueDay !== undefined ? { dueDay: dto.dueDay } : {}),
        ...(dto.maxOccurrences !== undefined ? { maxOccurrences: dto.maxOccurrences } : {}),
        ...(dto.defaultAmount != null
          ? { defaultAmount: new Prisma.Decimal(dto.defaultAmount) }
          : {}),
        ...(dto.partnerId !== undefined ? { partnerId: dto.partnerId } : {}),
        ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
        ...(dto.costCenterId !== undefined ? { costCenterId: dto.costCenterId } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });

    return this.findOne(companyId, id);
  }

  /** Encerra a recorrência. Os títulos já gerados permanecem: são fatos. */
  async deactivate(companyId: string, id: string) {
    await this.findOne(companyId, id);
    await this.prisma.db.recurrence.update({ where: { id }, data: { isActive: false } });
  }

  /**
   * Gera os títulos devidos até a data informada (RF-053).
   *
   * Avança ocorrência por ocorrência a partir de `nextRunDate`, respeitando o
   * fim do contrato e o número máximo de ocorrências. Cada rodada é limitada a
   * `MAX_ENTRIES_PER_RUN`: uma recorrência diária esquecida por dois anos
   * geraria setecentos títulos numa requisição — o teto transforma isso em
   * várias chamadas conscientes em vez de um timeout no meio da criação.
   */
  async generate(companyId: string, id: string, dto: GenerateRecurrenceDto, userId: string) {
    const recurrence = await this.findOne(companyId, id);

    if (!recurrence.isActive) {
      throw new ConflictException('Recorrência encerrada não gera títulos.');
    }
    if (!recurrence.nextRunDate) {
      throw new ConflictException('Recorrência já gerou todas as suas ocorrências.');
    }

    const amount = dto.amount ?? recurrence.defaultAmount?.toFixed(2);
    if (!amount) {
      throw new BadRequestException(
        'Informe o valor desta rodada ou cadastre um valor padrão na recorrência.',
      );
    }

    const until = dto.until ? toDateOnly(dto.until) : this.today();
    const created: { id: string; number: string; dueDate: string }[] = [];

    return this.prisma.transaction(async () => {
      let next: Date | null = recurrence.nextRunDate;
      let generated = recurrence.generatedCount;

      while (next && next <= until && created.length < MAX_ENTRIES_PER_RUN) {
        if (recurrence.endDate && next > recurrence.endDate) break;
        if (recurrence.maxOccurrences && generated >= recurrence.maxOccurrences) break;

        const dueDate = formatDateOnly(next);
        const entry = await this.entries.createEntry(
          companyId,
          {
            type: recurrence.type,
            description: recurrence.description,
            partnerId: recurrence.partnerId ?? undefined,
            categoryId: recurrence.categoryId ?? undefined,
            costCenterId: recurrence.costCenterId ?? undefined,
            grossAmount: amount,
            issueDate: dueDate,
            firstDueDate: dueDate,
          },
          userId,
          {
            origin: ENTRY_ORIGIN.RECURRENCE,
            originId: recurrence.id,
            recurrenceId: recurrence.id,
          },
        );

        created.push({ id: entry.id, number: entry.number, dueDate });
        generated += 1;
        next = await this.nextOccurrence(next, recurrence.periodicity, recurrence.dueDay);
      }

      if (created.length === 0) {
        throw new ConflictException(
          `Nada a gerar: a próxima ocorrência é ${formatDateOnly(recurrence.nextRunDate!)}.`,
        );
      }

      const exhausted =
        !next ||
        (recurrence.endDate && next > recurrence.endDate) ||
        (recurrence.maxOccurrences != null && generated >= recurrence.maxOccurrences);

      await this.prisma.db.recurrence.update({
        where: { id },
        data: {
          generatedCount: generated,
          nextRunDate: exhausted ? null : next,
          ...(exhausted ? { isActive: false } : {}),
        },
      });

      return { recurrence: await this.findOne(companyId, id), entries: created };
    });
  }

  /** Próxima data segundo a periodicidade — a regra do dia 31 vive no banco. */
  private async nextOccurrence(
    base: Date,
    periodicity: Periodicity,
    dueDay: number | null,
  ): Promise<Date | null> {
    const [row] = await this.prisma.db.$queryRaw<{ proxima: Date | null }[]>`
      SELECT fn_proxima_ocorrencia(
               ${formatDateOnly(base)}::date,
               ${periodicity}::enum_periodicidade,
               ${dueDay}::smallint
             ) AS proxima
    `;
    return row.proxima;
  }

  private async assertReferences(
    companyId: string,
    type: EntryType,
    dto: { partnerId?: string; categoryId?: string; costCenterId?: string },
  ) {
    await this.references.assert(companyId, {
      categoryId: dto.categoryId,
      costCenterId: dto.costCenterId,
      ...(dto.partnerId
        ? type === EntryType.RECEBER
          ? { customerId: dto.partnerId }
          : { supplierId: dto.partnerId }
        : {}),
    });
  }

  /** Hoje como dia civil — a recorrência trabalha em datas, não em instantes. */
  private today(): Date {
    return toDateOnly(formatDateOnly(new Date()));
  }
}
