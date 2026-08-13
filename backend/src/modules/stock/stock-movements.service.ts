import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, StockMovementType } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/paginated-result';
import { CreateStockMovementDto, StockEntryType } from './dto/create-stock-movement.dto';
import { CreateStockTransferDto } from './dto/create-stock-transfer.dto';
import { QueryStockMovementDto } from './dto/query-stock-movement.dto';

/** Processo que deu causa ao lançamento — `movimento_estoque.origem_tipo`. */
export const MOVEMENT_ORIGIN = {
  MANUAL: 'MANUAL',
  TRANSFER: 'TRANSFERENCIA',
  INVENTORY: 'INVENTARIO',
} as const;

const movementInclude = {
  product: { select: { id: true, code: true, description: true } },
  location: { select: { id: true, code: true, name: true } },
  counterpart: { select: { id: true, code: true, name: true } },
  user: { select: { id: true, name: true } },
} satisfies Prisma.StockMovementInclude;

type MovementRow = Prisma.StockMovementGetPayload<{ include: typeof movementInclude }>;

/** Tipos aceitos no lançamento avulso, mapeados para o enum do banco. */
const ENTRY_TYPES: Record<StockEntryType, StockMovementType> = {
  [StockEntryType.ENTRADA]: StockMovementType.ENTRADA,
  [StockEntryType.SAIDA]: StockMovementType.SAIDA,
  [StockEntryType.AJUSTE_POSITIVO]: StockMovementType.AJUSTE_POSITIVO,
  [StockEntryType.AJUSTE_NEGATIVO]: StockMovementType.AJUSTE_NEGATIVO,
};

/** Lançamento pronto para o razão — o que a API monta antes do INSERT. */
export interface StockMovementInput {
  companyId: string;
  productId: string;
  locationId: string;
  counterpartId?: string;
  type: StockMovementType;
  quantity: Prisma.Decimal;
  unitCost: Prisma.Decimal;
  movementDate?: Date;
  origin: string;
  originId?: string;
  batch?: string;
  note?: string;
  userId?: string;
}

/**
 * Movimentação de estoque (RF-032/RF-034) — `gestao.movimento_estoque`.
 *
 * O razão é a **única** porta de entrada do estoque: saldo e custo médio são
 * projeção mantida por trigger (bd/08), e a role da aplicação não tem
 * privilégio de escrita sobre `estoque_saldo`. Não existe atualização nem
 * remoção de lançamento — o banco recusa as duas (append-only, RF-032) e o
 * estorno se faz com o movimento contrário.
 *
 * As validações abaixo repetem regras que o banco também aplica. A duplicação é
 * proposital: aqui elas viram 400 com a mensagem do domínio, em vez de 500 de
 * violação de integridade.
 */
@Injectable()
export class StockMovementsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Entrada, saída ou ajuste em um local (RF-032). */
  async create(companyId: string, dto: CreateStockMovementDto, userId: string) {
    const product = await this.assertMovable(companyId, dto.productId);
    await this.assertLocation(companyId, dto.locationId);

    const quantity = this.assertPositive(dto.quantity);
    const type = ENTRY_TYPES[dto.type];
    const isAdjustment =
      type === StockMovementType.AJUSTE_POSITIVO || type === StockMovementType.AJUSTE_NEGATIVO;

    // Ajuste é correção de saldo sem fato comercial que a explique: sem
    // justificativa, a diferença fica indistinguível de desvio.
    if (isAdjustment && !dto.note?.trim()) {
      throw new BadRequestException('Informe a justificativa do ajuste de estoque (RF-032).');
    }

    const unitCost = await this.resolveUnitCost(dto, type, product.averageCost);

    const [movement] = await this.record(companyId, [
      {
        companyId,
        productId: dto.productId,
        locationId: dto.locationId,
        type,
        quantity,
        unitCost,
        movementDate: dto.movementDate ? new Date(dto.movementDate) : undefined,
        origin: MOVEMENT_ORIGIN.MANUAL,
        batch: dto.batch,
        note: dto.note,
        userId,
      },
    ]);

    return movement;
  }

  /**
   * Transferência entre locais (RF-032).
   *
   * Duas pernas na mesma transação: se a entrada no destino falhar, a saída da
   * origem é revertida junto. Meia transferência faria mercadoria desaparecer
   * do estoque sem ter saído da empresa.
   */
  async transfer(companyId: string, dto: CreateStockTransferDto, userId: string) {
    if (dto.fromLocationId === dto.toLocationId) {
      throw new BadRequestException('A transferência exige locais de origem e destino diferentes.');
    }

    await this.assertMovable(companyId, dto.productId);
    await this.assertLocation(companyId, dto.fromLocationId);
    await this.assertLocation(companyId, dto.toLocationId);

    const quantity = this.assertPositive(dto.quantity);
    const movementDate = dto.movementDate ? new Date(dto.movementDate) : undefined;
    // A mercadoria viaja com o custo que tinha na origem: valorizar a entrada
    // por outro número criaria (ou destruiria) valor numa operação interna.
    const unitCost = await this.currentCost(dto.productId, dto.fromLocationId);
    const transferId = randomUUID();

    const common = {
      companyId,
      productId: dto.productId,
      quantity,
      unitCost,
      movementDate,
      origin: MOVEMENT_ORIGIN.TRANSFER,
      // Liga as duas pernas: sem uma chave comum, a transferência só é
      // reconstituível por coincidência de data e quantidade.
      originId: transferId,
      batch: dto.batch,
      note: dto.note,
      userId,
    };

    const [outbound, inbound] = await this.record(companyId, [
      {
        ...common,
        type: StockMovementType.TRANSFERENCIA_SAIDA,
        locationId: dto.fromLocationId,
        counterpartId: dto.toLocationId,
      },
      {
        ...common,
        type: StockMovementType.TRANSFERENCIA_ENTRADA,
        locationId: dto.toLocationId,
        counterpartId: dto.fromLocationId,
      },
    ]);

    return { transferId, outbound, inbound };
  }

  async findAll(companyId: string, query: QueryStockMovementDto) {
    const where: Prisma.StockMovementWhereInput = {
      companyId,
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.locationId ? { locationId: query.locationId } : {}),
      ...(query.type ? { type: query.type } : {}),
      // Período semiaberto (`from` inclusivo, `to` exclusivo), como na trilha de
      // auditoria: com `lte`, um movimento das 23:59:59.7 do último dia ficaria
      // de fora do relatório do mês.
      ...(query.from || query.to
        ? {
            movementDate: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lt: new Date(query.to) } : {}),
            },
          }
        : {}),
    };

    const data = await this.prisma.db.stockMovement.findMany({
      where,
      include: movementInclude,
      orderBy: [{ movementDate: 'desc' }, { createdAt: 'desc' }],
      skip: query.skip,
      take: query.take,
    });
    const total = await this.prisma.db.stockMovement.count({ where });

    return new PaginatedResult(data, total, query.page, query.pageSize);
  }

  /**
   * Grava os lançamentos na transação da requisição, em ordem.
   *
   * Sequencial de propósito: os triggers de bd/08 tomam um lock por
   * (produto, local) e calculam saldo anterior/posterior a partir da posição
   * corrente — em paralelo, as duas pernas de uma transferência entre o mesmo
   * par leriam o mesmo saldo.
   *
   * Reutilizado pelo fechamento do inventário (RF-033), que também precisa que
   * todos os ajustes entrem ou nenhum entre.
   */
  async record(companyId: string, inputs: StockMovementInput[]): Promise<MovementRow[]> {
    return this.prisma.transaction(async () => {
      const created: MovementRow[] = [];
      for (const input of inputs) {
        created.push(
          await this.prisma.db.stockMovement.create({
            data: {
              companyId,
              productId: input.productId,
              locationId: input.locationId,
              counterpartId: input.counterpartId,
              type: input.type,
              quantity: input.quantity,
              unitCost: input.unitCost,
              ...(input.movementDate ? { movementDate: input.movementDate } : {}),
              origin: input.origin,
              originId: input.originId,
              batch: input.batch,
              note: input.note,
              userId: input.userId,
            },
            include: movementInclude,
          }),
        );
      }
      return created;
    });
  }

  /** Custo médio corrente do par produto/local — base da valorização da saída. */
  async currentCost(productId: string, locationId: string): Promise<Prisma.Decimal> {
    const balance = await this.prisma.db.stockBalance.findFirst({
      where: { productId, locationId },
      select: { averageCost: true },
    });
    return balance?.averageCost ?? new Prisma.Decimal(0);
  }

  /**
   * Entrada exige custo: sem ele, a média ponderada seria puxada para zero e o
   * CMV do que sair depois viraria lucro aparente (RF-034). O ajuste positivo,
   * ao contrário, é sobra do que já estava lá — vale o custo corrente.
   */
  private async resolveUnitCost(
    dto: CreateStockMovementDto,
    type: StockMovementType,
    productAverageCost: Prisma.Decimal,
  ): Promise<Prisma.Decimal> {
    if (dto.unitCost !== undefined) {
      const informed = new Prisma.Decimal(dto.unitCost);
      if (type === StockMovementType.ENTRADA && informed.lessThanOrEqualTo(0)) {
        throw new BadRequestException('A entrada exige custo unitário maior que zero (RF-034).');
      }
      return informed;
    }

    if (type === StockMovementType.ENTRADA) {
      throw new BadRequestException('Informe o custo unitário da entrada (RF-034).');
    }

    const current = await this.currentCost(dto.productId, dto.locationId);
    // Local ainda sem saldo formado: o custo do item na empresa é a melhor
    // aproximação disponível, e é o que a valorização já usa.
    return current.isZero() ? productAverageCost : current;
  }

  private assertPositive(quantity: string): Prisma.Decimal {
    const value = new Prisma.Decimal(quantity);
    if (value.lessThanOrEqualTo(0)) {
      throw new BadRequestException('A quantidade movimentada deve ser maior que zero.');
    }
    return value;
  }

  /** Item existente, ativo e com controle de estoque (RF-031). */
  private async assertMovable(companyId: string, productId: string) {
    const product = await this.prisma.db.product.findFirst({
      where: { id: productId, companyId },
      select: { id: true, code: true, tracksStock: true, isActive: true, averageCost: true },
    });
    if (!product) {
      throw new BadRequestException('Produto inválido para esta empresa.');
    }
    if (!product.tracksStock) {
      throw new BadRequestException(`O item ${product.code} não controla estoque (RF-031).`);
    }
    if (!product.isActive) {
      throw new BadRequestException(`O item ${product.code} está inativo e não pode movimentar.`);
    }
    return product;
  }

  private async assertLocation(companyId: string, locationId: string) {
    const location = await this.prisma.db.stockLocation.findFirst({
      where: { id: locationId, companyId },
      select: { id: true, code: true, isActive: true },
    });
    if (!location) {
      throw new BadRequestException('Local de estoque inválido para esta empresa.');
    }
    if (!location.isActive) {
      throw new BadRequestException(
        `O local ${location.code} está inativo e não aceita movimento.`,
      );
    }
    return location;
  }
}
