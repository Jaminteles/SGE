import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { EntryType, FiscalDocumentStatus, Prisma, StockMovementType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ReferencesService } from '../../common/references/references.service';
import { formatDateOnly } from '../../common/utils/date-only';
import {
  MOVEMENT_ORIGIN,
  StockMovementInput,
  StockMovementsService,
} from '../stock/stock-movements.service';
import { ENTRY_ORIGIN, FinancialEntriesService } from '../finance/financial-entries.service';
import { FiscalDocumentRow, FiscalDocumentsService } from './fiscal-documents.service';
import { PostFiscalDocumentDto } from './dto/post-fiscal-document.dto';

/** Uma linha da nota pronta para virar entrada de estoque. */
interface PlannedEntry {
  itemId: string;
  productId: string;
  locationId: string;
  quantity: Prisma.Decimal;
  /** Preço mais a parcela da linha no frete: o custo posto (RF-034). */
  landedCost: Prisma.Decimal;
  note?: string;
}

/**
 * Efeitos da nota em estoque e financeiro (RF-047) — a segunda porta de entrada
 * da compra, e a que só se abre quando a primeira não existe.
 *
 * Quando há pedido e conferência (M06), quem dá entrada é o recebimento: a nota
 * se vincula e nada é gerado aqui. Sem pedido — a compra de balcão, o
 * fornecedor que entrega com a nota e nada mais — a nota **é** o fato de
 * entrada, e é este serviço que a converte em mercadoria no depósito e em conta
 * a pagar.
 *
 * Que as duas portas nunca se abram para a mesma mercadoria é garantido no banco
 * (bd/12): os índices únicos recusam o replay da mesma linha, e um trigger
 * recusa a nota cujo recebimento já produziu o efeito. As conferências abaixo
 * existem para que isso chegue como 409 explicado, e não como violação de regra.
 *
 * Nenhum dos dois efeitos se desfaz por aqui: estorno de estoque é lançamento
 * contrário no razão (RF-032) e título indevido se cancela no M08.
 */
@Injectable()
export class FiscalPostingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly references: ReferencesService,
    private readonly documents: FiscalDocumentsService,
    private readonly movements: StockMovementsService,
    private readonly entries: FinancialEntriesService,
  ) {}

  async post(companyId: string, id: string, dto: PostFiscalDocumentDto, userId: string) {
    if (!dto.generateStock && !dto.generatePayable) {
      throw new BadRequestException(
        'Informe ao menos um efeito: entrada de estoque ou título a pagar (RF-047).',
      );
    }

    const document = await this.documents.findOne(companyId, id);
    this.assertPostable(document, dto);

    await this.references.assert(companyId, { stockLocationId: dto.locationId });

    const lines = dto.generateStock ? await this.planEntries(companyId, document, dto) : [];

    return this.prisma.transaction(async () => {
      if (lines.length > 0) {
        await this.movements.record(
          companyId,
          lines.map((line) => this.toMovement(line, document, userId)),
        );
      }

      if (dto.generatePayable) {
        await this.createPayable(companyId, document, dto, userId);
      }

      return this.documents.findOne(companyId, id);
    });
  }

  /**
   * O documento pode produzir efeito? (RF-047/RF-049)
   *
   * A marca de "já gerou" é projeção do que existe (bd/12) e cobre as duas
   * portas — inclusive o efeito produzido pelo recebimento que referencia esta
   * nota. É por isso que ela basta como conferência.
   */
  private assertPostable(document: FiscalDocumentRow, dto: PostFiscalDocumentDto): void {
    if (document.status !== FiscalDocumentStatus.PROCESSADO) {
      throw new ConflictException(
        `O documento ${document.number} está ${document.status}: só documento processado gera efeito (RF-049).`,
      );
    }
    if (dto.generateStock && document.generatedStock) {
      throw new ConflictException(
        `O documento ${document.number} já deu entrada no estoque (RN-004).`,
      );
    }
    if (dto.generatePayable && document.generatedPayable) {
      throw new ConflictException(
        `O documento ${document.number} já gerou título a pagar (RN-004).`,
      );
    }
    if (!document.issuerPartnerId) {
      throw new ConflictException(
        `Vincule o fornecedor emitente do documento ${document.number} antes de gerar efeito (RF-047).`,
      );
    }
    if (document.receipts.length > 0) {
      throw new ConflictException(
        `O documento ${document.number} está vinculado a um recebimento: a entrada é dele (RN-004).`,
      );
    }
  }

  /**
   * Linhas que entram no estoque, valorizadas pelo custo posto.
   *
   * Só entram itens vinculados a produto que controla estoque: serviço e item
   * não catalogado ficam de fora — e o item sem produto **impede** a entrada, em
   * vez de ser ignorado em silêncio. Dar entrada em parte da nota deixaria o
   * resto invisível, e ninguém procura o que não aparece.
   */
  private async planEntries(
    companyId: string,
    document: FiscalDocumentRow,
    dto: PostFiscalDocumentDto,
  ): Promise<PlannedEntry[]> {
    const unmapped = document.items.filter((item) => !item.productId);
    if (unmapped.length > 0) {
      throw new ConflictException(
        `Vincule ao catálogo os itens ${unmapped.map((item) => item.sequence).join(', ')} do documento ${document.number} antes de dar entrada (RF-047).`,
      );
    }

    const stocked = document.items.filter((item) => item.product?.tracksStock);
    if (stocked.length === 0) {
      throw new BadRequestException(
        `Nenhum item do documento ${document.number} controla estoque: não há entrada a registrar (RF-031).`,
      );
    }

    const locationId = dto.locationId;
    if (!locationId) {
      throw new BadRequestException('Informe o local de estoque da entrada (RF-031).');
    }

    // O frete do cabeçalho é rateado pelo valor das linhas, como no pedido de
    // compra (bd/11): frete que fica só no cabeçalho vira lucro aparente na
    // primeira saída.
    const freight = document.freightAmount
      .plus(document.insuranceAmount)
      .plus(document.otherExpenseAmount);
    const base = stocked.reduce(
      (total, item) => total.plus(item.lineAmount),
      new Prisma.Decimal(0),
    );

    return stocked.map((item) => {
      const share =
        freight.isZero() || base.isZero()
          ? new Prisma.Decimal(0)
          : freight.times(item.lineAmount).dividedBy(base);
      const landed = item.lineAmount
        .plus(share)
        .dividedBy(item.quantity)
        .toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP);

      return {
        itemId: item.id,
        productId: item.productId!,
        locationId,
        quantity: item.quantity,
        // Custo zero não entra no razão (bd/08). Nota de bonificação existe, e o
        // que ela custou é o que ela diz: o preço unitário da linha.
        landedCost: landed.greaterThan(0) ? landed : item.unitPrice,
        note: `Documento fiscal ${document.number} — item ${item.sequence}`,
      };
    });
  }

  private toMovement(
    line: PlannedEntry,
    document: FiscalDocumentRow,
    userId: string,
  ): StockMovementInput {
    return {
      companyId: document.companyId,
      productId: line.productId,
      locationId: line.locationId,
      type: StockMovementType.ENTRADA,
      quantity: line.quantity,
      unitCost: line.landedCost,
      movementDate: document.movedAt ?? document.issuedAt,
      origin: MOVEMENT_ORIGIN.FISCAL_DOCUMENT,
      // O item, e não o documento: é o que dá ao índice único de bd/12 a
      // granularidade de uma entrada por linha.
      originId: line.itemId,
      fiscalDocumentId: document.id,
      note: line.note,
      userId,
    };
  }

  /**
   * Título a pagar do valor da nota (RF-047 → RF-051).
   *
   * O valor é o total do documento — o que o fornecedor cobra, incluindo frete e
   * tributos destacados. Não é a soma das linhas de estoque: parte da nota pode
   * ser serviço, e o boleto é um só.
   */
  private async createPayable(
    companyId: string,
    document: FiscalDocumentRow,
    dto: PostFiscalDocumentDto,
    userId: string,
  ) {
    const payable = dto.payable ?? {};

    await this.entries.createEntry(
      companyId,
      {
        type: EntryType.PAGAR,
        description: `Documento fiscal ${document.number}${document.series ? `/${document.series}` : ''} — ${document.issuerName ?? 'fornecedor'}`,
        documentReference: document.accessKey ?? document.number,
        partnerId: document.issuerPartnerId!,
        branchId: document.branchId ?? undefined,
        grossAmount: document.totalAmount.toFixed(2),
        issueDate: formatDateOnly(document.issuedAt),
        categoryId: payable.categoryId,
        costCenterId: payable.costCenterId,
        paymentMethodId: payable.paymentMethodId,
        paymentTermId: payable.paymentTermId,
        firstDueDate: payable.firstDueDate,
        installmentCount: payable.installmentCount,
        intervalDays: payable.intervalDays,
        dailyInterestRate: payable.dailyInterestRate,
        penaltyRate: payable.penaltyRate,
        note: payable.note,
      },
      userId,
      {
        origin: ENTRY_ORIGIN.FISCAL_DOCUMENT,
        // O documento inteiro: um título por nota é o que o índice único de
        // bd/12 garante.
        originId: document.id,
        fiscalDocumentId: document.id,
        purchaseOrderId: document.purchaseOrderId ?? undefined,
      },
    );
  }
}
