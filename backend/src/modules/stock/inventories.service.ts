import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditEvent, Prisma, StockMovementType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/paginated-result';
import { AuditService, AUDIT_ENTITY } from '../../common/audit/audit.service';
import { AuthenticatedUser } from '../../common/authorization/authenticated-user';
import { InventoryStatus } from '../../common/enums';
import { ReferencesService } from '../../common/references/references.service';
import { MOVEMENT_ORIGIN, StockMovementsService } from './stock-movements.service';
import { CreateInventoryDto } from './dto/create-inventory.dto';
import { CountInventoryDto } from './dto/count-inventory.dto';
import { CancelInventoryDto } from './dto/cancel-inventory.dto';
import { QueryInventoryDto } from './dto/query-inventory.dto';

/**
 * Transições permitidas (RF-033) — as mesmas que o trigger de bd/08 aplica.
 * Um inventário concluído ou cancelado é terminal: recontagem é inventário novo.
 */
const TRANSITIONS: Record<InventoryStatus, InventoryStatus[]> = {
  [InventoryStatus.ABERTO]: [InventoryStatus.EM_CONTAGEM, InventoryStatus.CANCELADO],
  [InventoryStatus.EM_CONTAGEM]: [InventoryStatus.CONCLUIDO, InventoryStatus.CANCELADO],
  [InventoryStatus.CONCLUIDO]: [],
  [InventoryStatus.CANCELADO]: [],
};

const inventoryInclude = {
  location: {
    select: {
      id: true,
      code: true,
      name: true,
      branch: { select: { id: true, code: true, name: true } },
    },
  },
  responsible: { select: { id: true, name: true } },
  items: {
    orderBy: { product: { code: 'asc' } },
    include: { product: { select: { id: true, code: true, description: true } } },
  },
} satisfies Prisma.InventoryInclude;

type InventoryRow = Prisma.InventoryGetPayload<{ include: typeof inventoryInclude }>;

/**
 * Inventário de contagem física (RF-033) — `gestao.inventario`.
 *
 * A quantidade do sistema é fotografada na abertura e o banco a torna imutável
 * (bd/08): é contra ela que a diferença foi apurada. O ajuste não é escrito no
 * saldo — vira lançamento no razão, como qualquer outra alteração de estoque,
 * para que a sobra ou a falta apareça na movimentação com origem `INVENTARIO`.
 */
@Injectable()
export class InventoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly references: ReferencesService,
    private readonly movements: StockMovementsService,
    private readonly audit: AuditService,
  ) {}

  async create(companyId: string, dto: CreateInventoryDto, userId: string) {
    await this.references.assert(companyId, { stockLocationId: dto.locationId });
    await this.references.assertUserBelongsToCompany(companyId, dto.responsibleId);

    // O índice único de bd/08 já recusaria a segunda contagem aberta; a
    // pergunta aqui existe para responder 409 com o número do inventário em
    // curso, em vez de um erro de integridade.
    const open = await this.prisma.db.inventory.findFirst({
      where: {
        companyId,
        locationId: dto.locationId,
        status: { in: [InventoryStatus.ABERTO, InventoryStatus.EM_CONTAGEM] },
      },
      select: { number: true },
    });
    if (open) {
      throw new ConflictException(`O local já tem o inventário ${open.number} em andamento.`);
    }

    const snapshot = await this.snapshot(companyId, dto.locationId, dto.productIds);
    if (snapshot.length === 0) {
      throw new BadRequestException('Não há itens a contar neste local.');
    }

    return this.prisma.transaction(async () => {
      const number = await this.nextNumber(companyId);
      const created = await this.prisma.db.inventory.create({
        data: {
          companyId,
          locationId: dto.locationId,
          number,
          description: dto.description,
          responsibleId: dto.responsibleId ?? userId,
          items: { create: snapshot },
        },
        select: { id: true },
      });
      return this.findOne(companyId, created.id);
    });
  }

  async findAll(companyId: string, query: QueryInventoryDto) {
    const where: Prisma.InventoryWhereInput = {
      companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.locationId ? { locationId: query.locationId } : {}),
      ...(query.q
        ? {
            OR: [
              { number: { contains: query.q, mode: 'insensitive' } },
              { description: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const data = await this.prisma.db.inventory.findMany({
      where,
      include: inventoryInclude,
      orderBy: [{ startedAt: 'desc' }, { number: 'desc' }],
      skip: query.skip,
      take: query.take,
    });
    const total = await this.prisma.db.inventory.count({ where });

    return new PaginatedResult(data, total, query.page, query.pageSize);
  }

  async findOne(companyId: string, id: string): Promise<InventoryRow> {
    const inventory = await this.prisma.db.inventory.findFirst({
      where: { id, companyId },
      include: inventoryInclude,
    });
    if (!inventory) {
      throw new NotFoundException('Inventário não encontrado.');
    }
    return inventory;
  }

  /** Libera a contagem: a partir daqui o inventário aceita quantidades. */
  async startCount(companyId: string, id: string) {
    const current = await this.findOne(companyId, id);
    this.assertTransition(current, InventoryStatus.EM_CONTAGEM);

    await this.prisma.db.inventory.update({
      where: { id },
      data: { status: InventoryStatus.EM_CONTAGEM },
    });
    return this.findOne(companyId, id);
  }

  /** Lança as quantidades apuradas (RF-033). A diferença é calculada no banco. */
  async count(companyId: string, id: string, dto: CountInventoryDto) {
    const current = await this.findOne(companyId, id);
    if (current.status !== InventoryStatus.EM_CONTAGEM) {
      throw new ConflictException(
        'Inicie a contagem antes de lançar quantidades (POST /inventories/:id/start).',
      );
    }

    const byProduct = new Map(current.items.map((item) => [item.productId, item]));
    for (const entry of dto.counts) {
      if (!byProduct.has(entry.productId)) {
        throw new BadRequestException(
          `O produto ${entry.productId} não faz parte deste inventário.`,
        );
      }
    }

    await this.prisma.transaction(async () => {
      for (const entry of dto.counts) {
        await this.prisma.db.inventoryItem.update({
          where: { id: byProduct.get(entry.productId)!.id },
          data: {
            countedQuantity: new Prisma.Decimal(entry.countedQuantity),
            ...(entry.note !== undefined ? { note: entry.note } : {}),
          },
        });
      }
    });

    return this.findOne(companyId, id);
  }

  /**
   * Conclui a contagem e ajusta o estoque (RF-033/RF-032).
   *
   * Exige `inventories:APPROVE` e não ser o responsável pela contagem: o
   * fechamento escreve uma perda ou uma sobra direto no ativo, e quem contou
   * não homologa a própria diferença (RN-003).
   */
  async close(companyId: string, id: string, approver: AuthenticatedUser) {
    const current = await this.findOne(companyId, id);
    this.assertTransition(current, InventoryStatus.CONCLUIDO);

    if (current.responsibleId && current.responsibleId === approver.id && !approver.isSuperAdmin) {
      throw new ForbiddenException('O responsável pela contagem não pode concluí-la (RN-003).');
    }

    const pending = current.items.filter((item) => item.countedQuantity === null);
    if (pending.length > 0) {
      throw new BadRequestException(
        `Conte todos os itens antes de concluir (${pending.length} pendente(s)).`,
      );
    }

    const divergent = current.items.filter((item) => !item.difference.isZero());

    return this.prisma.transaction(async () => {
      if (divergent.length > 0) {
        await this.movements.record(
          companyId,
          divergent.map((item) => ({
            companyId,
            productId: item.productId,
            locationId: current.locationId,
            type: item.difference.isPositive()
              ? StockMovementType.AJUSTE_POSITIVO
              : StockMovementType.AJUSTE_NEGATIVO,
            quantity: item.difference.abs(),
            unitCost: item.unitCost ?? new Prisma.Decimal(0),
            origin: MOVEMENT_ORIGIN.INVENTORY,
            originId: current.id,
            note: `Inventário ${current.number}`,
            userId: approver.id,
          })),
        );

        // Marcado antes da mudança de situação: o trigger de bd/08 recusa
        // escrita em item de inventário já concluído.
        await this.prisma.db.inventoryItem.updateMany({
          where: { id: { in: divergent.map((item) => item.id) } },
          data: { isAdjusted: true },
        });
      }

      await this.prisma.db.inventory.update({
        where: { id },
        data: { status: InventoryStatus.CONCLUIDO, finishedAt: new Date() },
      });

      await this.audit.record({
        event: AuditEvent.FECHAMENTO,
        entity: AUDIT_ENTITY.INVENTORY,
        entityId: id,
        note: `Inventário ${current.number} concluído com ${divergent.length} ajuste(s) de ${current.items.length} item(ns).`,
      });

      return this.findOne(companyId, id);
    });
  }

  /** Cancela a contagem. O motivo vai para a trilha — não há coluna para ele. */
  async cancel(companyId: string, id: string, dto: CancelInventoryDto) {
    const current = await this.findOne(companyId, id);
    this.assertTransition(current, InventoryStatus.CANCELADO);

    await this.prisma.db.inventory.update({
      where: { id },
      data: { status: InventoryStatus.CANCELADO },
    });

    await this.audit.record({
      event: AuditEvent.CANCELAMENTO,
      entity: AUDIT_ENTITY.INVENTORY,
      entityId: id,
      note: `Inventário ${current.number} cancelado: ${dto.reason}`,
    });

    return this.findOne(companyId, id);
  }

  /**
   * Fotografia dos saldos do local no momento da abertura.
   *
   * Sem `productIds`, entram os itens que têm linha de saldo no local — é a
   * contagem geral. Com a lista, entram os informados mesmo sem saldo: contar
   * onde o sistema diz que não há nada é justamente como se acha estoque que
   * nunca foi lançado.
   */
  private async snapshot(companyId: string, locationId: string, productIds?: string[]) {
    if (productIds?.length) {
      const products = await this.prisma.db.product.findMany({
        where: { companyId, id: { in: productIds }, tracksStock: true },
        select: { id: true, averageCost: true },
      });
      if (products.length !== new Set(productIds).size) {
        throw new BadRequestException(
          'A lista contém item inexistente nesta empresa ou que não controla estoque.',
        );
      }

      const balances = await this.prisma.db.stockBalance.findMany({
        where: { companyId, locationId, productId: { in: productIds } },
        select: { productId: true, quantity: true, averageCost: true },
      });
      const byProduct = new Map(balances.map((b) => [b.productId, b]));

      return products.map((product) => ({
        companyId,
        productId: product.id,
        systemQuantity: byProduct.get(product.id)?.quantity ?? new Prisma.Decimal(0),
        unitCost: byProduct.get(product.id)?.averageCost ?? product.averageCost,
      }));
    }

    const balances = await this.prisma.db.stockBalance.findMany({
      where: { companyId, locationId },
      select: { productId: true, quantity: true, averageCost: true },
    });

    return balances.map((balance) => ({
      companyId,
      productId: balance.productId,
      systemQuantity: balance.quantity,
      unitCost: balance.averageCost,
    }));
  }

  /** Número sequencial por empresa e ano, serializado no banco (bd/08). */
  private async nextNumber(companyId: string): Promise<string> {
    const [row] = await this.prisma.db.$queryRaw<{ numero: string }[]>`
      SELECT fn_proximo_numero_inventario(${companyId}::uuid) AS numero
    `;
    return row.numero;
  }

  private assertTransition(inventory: InventoryRow, to: InventoryStatus): void {
    const from = inventory.status as InventoryStatus;
    if (!TRANSITIONS[from]?.includes(to)) {
      throw new ConflictException(`Inventário ${from} não pode ir para ${to}.`);
    }
  }
}
