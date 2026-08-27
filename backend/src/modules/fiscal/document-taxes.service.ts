import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TaxClassificationType } from '../../common/enums';
import { PrismaService } from '../../prisma/prisma.service';
import { ClassifyDocumentItemDto } from './dto/document-tax.dto';
import { TaxClassificationsService } from './tax-classifications.service';

/** Tolerância na comparação de alíquotas: o XML traz o valor já arredondado. */
const RATE_TOLERANCE = new Prisma.Decimal('0.01');

const itemSelect = {
  id: true,
  sequence: true,
  description: true,
  ncm: true,
  cest: true,
  cfop: true,
  quantity: true,
  unitPrice: true,
  lineAmount: true,
  icmsCst: true,
  icmsBase: true,
  icmsRate: true,
  icmsAmount: true,
  icmsStAmount: true,
  ipiAmount: true,
  pisAmount: true,
  cofinsAmount: true,
  classificationId: true,
  classification: {
    select: { id: true, code: true, description: true, icmsRate: true, ipiRate: true },
  },
} satisfies Prisma.FiscalDocumentItemSelect;

type ItemRow = Prisma.FiscalDocumentItemGetPayload<{ select: typeof itemSelect }>;

/** Divergência entre o que a nota declarou e o que o cadastro esperava. */
export interface TaxDivergence {
  sequence: number;
  field: string;
  declared: string;
  expected: string;
  note: string;
}

export interface DocumentTaxSummary {
  documentId: string;
  number: string;
  series: string | null;
  accessKey: string | null;
  issuedAt: Date;
  status: string;
  /** Totais como o emitente declarou. Nada aqui é recalculado. */
  declared: {
    productsAmount: Prisma.Decimal;
    totalAmount: Prisma.Decimal;
    icmsAmount: Prisma.Decimal;
    icmsStAmount: Prisma.Decimal;
    ipiAmount: Prisma.Decimal;
    pisAmount: Prisma.Decimal;
    cofinsAmount: Prisma.Decimal;
    issAmount: Prisma.Decimal;
  };
  /** Soma dos itens, para conferência — informativa, não corretiva. */
  itemTotals: {
    lineAmount: Prisma.Decimal;
    icmsAmount: Prisma.Decimal;
    icmsStAmount: Prisma.Decimal;
    ipiAmount: Prisma.Decimal;
    pisAmount: Prisma.Decimal;
    cofinsAmount: Prisma.Decimal;
  };
  items: ItemRow[];
  divergences: TaxDivergence[];
  unclassifiedItems: number;
}

/**
 * Tributação dos documentos fiscais (RF-090).
 *
 * O que o emitente declarou já está gravado desde o M07, item a item. O que
 * faltava era **ler aquilo contra o cadastro da empresa**: ligar o NCM da linha
 * à classificação fiscal (RF-089) e apontar onde a alíquota declarada difere da
 * esperada.
 *
 * A regra que atravessa o serviço inteiro: **nada do declarado é reescrito**.
 * Valor, base, alíquota e o NCM do XML seguem como chegaram — o banco também
 * recusa alterá-los depois do processamento (bd/12). A única coluna que este
 * serviço escreve é `classificacao_fiscal_id`, que é leitura nossa sobre a nota,
 * como o vínculo com o produto do catálogo.
 *
 * Divergência, portanto, é **informação**, não correção. Corrigir XML de
 * terceiro para que ele pareça certo é perder a prova do que foi recebido.
 */
@Injectable()
export class DocumentTaxesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly classifications: TaxClassificationsService,
  ) {}

  /** Tributação declarada da nota, com divergências apontadas (RF-090). */
  async summary(companyId: string, documentId: string): Promise<DocumentTaxSummary> {
    const document = await this.findDocument(companyId, documentId);

    const items = await this.prisma.db.fiscalDocumentItem.findMany({
      where: { companyId, documentId },
      orderBy: { sequence: 'asc' },
      select: itemSelect,
    });

    const zero = new Prisma.Decimal(0);
    const itemTotals = items.reduce(
      (total, item) => ({
        lineAmount: total.lineAmount.plus(item.lineAmount),
        icmsAmount: total.icmsAmount.plus(item.icmsAmount),
        icmsStAmount: total.icmsStAmount.plus(item.icmsStAmount),
        ipiAmount: total.ipiAmount.plus(item.ipiAmount),
        pisAmount: total.pisAmount.plus(item.pisAmount),
        cofinsAmount: total.cofinsAmount.plus(item.cofinsAmount),
      }),
      {
        lineAmount: zero,
        icmsAmount: zero,
        icmsStAmount: zero,
        ipiAmount: zero,
        pisAmount: zero,
        cofinsAmount: zero,
      },
    );

    return {
      documentId: document.id,
      number: document.number,
      series: document.series,
      accessKey: document.accessKey,
      issuedAt: document.issuedAt,
      status: document.status,
      declared: {
        productsAmount: document.productsAmount,
        totalAmount: document.totalAmount,
        icmsAmount: document.icmsAmount,
        icmsStAmount: document.icmsStAmount,
        ipiAmount: document.ipiAmount,
        pisAmount: document.pisAmount,
        cofinsAmount: document.cofinsAmount,
        issAmount: document.issAmount,
      },
      itemTotals,
      items,
      divergences: this.divergences(items),
      unclassifiedItems: items.filter((item) => !item.classificationId).length,
    };
  }

  /**
   * Liga uma linha da nota à classificação de NCM cadastrada (RF-090).
   *
   * Só isso: o item continua com o NCM, a alíquota e o valor que o emitente
   * declarou. `classificationId` nulo desfaz o vínculo.
   */
  async classify(
    companyId: string,
    documentId: string,
    dto: ClassifyDocumentItemDto,
  ): Promise<ItemRow> {
    await this.findDocument(companyId, documentId);

    const item = await this.prisma.db.fiscalDocumentItem.findFirst({
      where: { companyId, documentId, sequence: dto.sequence },
      select: { id: true },
    });
    if (!item) {
      throw new NotFoundException('Item não encontrado neste documento fiscal.');
    }

    if (dto.classificationId) {
      const classification = await this.classifications.findUsable(
        companyId,
        dto.classificationId,
        TaxClassificationType.NCM,
      );
      if (!classification) {
        throw new BadRequestException(
          'Classificação de NCM inválida, inativa ou de outra empresa.',
        );
      }
    }

    return this.prisma.db.fiscalDocumentItem.update({
      where: { id: item.id },
      data: { classificationId: dto.classificationId ?? null },
      select: itemSelect,
    });
  }

  /**
   * Classifica de uma vez as linhas cujo NCM já existe no cadastro (RF-090).
   *
   * Só preenche o que está em branco: uma linha já classificada a mão não é
   * revista por rotina automática. Devolve quantas foram ligadas e quantas
   * seguem sem cadastro correspondente — estas são a lista de NCMs a cadastrar.
   */
  async autoClassify(
    companyId: string,
    documentId: string,
  ): Promise<{ classified: number; pending: string[] }> {
    await this.findDocument(companyId, documentId);

    const items = await this.prisma.db.fiscalDocumentItem.findMany({
      where: { companyId, documentId, classificationId: null, ncm: { not: null } },
      select: { id: true, ncm: true },
    });

    if (items.length === 0) {
      return { classified: 0, pending: [] };
    }

    const codes = [...new Set(items.map((item) => item.ncm!))];
    const catalog = await this.prisma.db.taxClassification.findMany({
      where: {
        companyId,
        type: TaxClassificationType.NCM,
        isActive: true,
        code: { in: codes },
      },
      select: { id: true, code: true },
    });
    const byCode = new Map(catalog.map((row) => [row.code, row.id]));

    let classified = 0;
    for (const [code, classificationId] of byCode) {
      const targets = items.filter((item) => item.ncm === code).map((item) => item.id);
      const result = await this.prisma.db.fiscalDocumentItem.updateMany({
        // `companyId` no where mesmo com os ids já filtrados: a RLS é a garantia,
        // e o filtro explícito impede que uma mudança futura na origem dos ids
        // transforme este updateMany em escrita fora da empresa.
        where: { id: { in: targets }, companyId },
        data: { classificationId },
      });
      classified += result.count;
    }

    return {
      classified,
      pending: codes.filter((code) => !byCode.has(code)),
    };
  }

  private async findDocument(companyId: string, documentId: string) {
    const document = await this.prisma.db.fiscalDocument.findFirst({
      where: { id: documentId, companyId },
      select: {
        id: true,
        number: true,
        series: true,
        accessKey: true,
        issuedAt: true,
        status: true,
        productsAmount: true,
        totalAmount: true,
        icmsAmount: true,
        icmsStAmount: true,
        ipiAmount: true,
        pisAmount: true,
        cofinsAmount: true,
        issAmount: true,
      },
    });
    if (!document) {
      throw new NotFoundException('Documento fiscal não encontrado.');
    }
    return document;
  }

  /**
   * Onde o declarado difere do cadastrado.
   *
   * Só compara o que dá para comparar: linha sem classificação e classificação
   * sem alíquota não produzem divergência — produziriam ruído, e o relatório que
   * aponta divergência em tudo deixa de ser lido.
   */
  private divergences(items: ItemRow[]): TaxDivergence[] {
    const found: TaxDivergence[] = [];

    for (const item of items) {
      const expected = item.classification?.icmsRate;
      if (!expected) continue;

      if (expected.minus(item.icmsRate).abs().greaterThan(RATE_TOLERANCE)) {
        found.push({
          sequence: item.sequence,
          field: 'icmsRate',
          declared: item.icmsRate.toString(),
          expected: expected.toString(),
          note: `A nota declarou ICMS de ${item.icmsRate.toString()}% e o cadastro do NCM ${
            item.classification?.code ?? ''
          } espera ${expected.toString()}%.`,
        });
      }
    }

    return found;
  }
}
