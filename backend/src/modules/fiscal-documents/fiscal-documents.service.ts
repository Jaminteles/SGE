import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditEvent, FiscalDocumentOrigin, FiscalDocumentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/paginated-result';
import { AUDIT_ENTITY, AuditService } from '../../common/audit/audit.service';
import { ReferencesService } from '../../common/references/references.service';
import { sha256Of, UploadedFile } from '../../common/storage/file-storage.service';
import { DEFAULT_XML_LIMITS } from '../../common/xml/xml-reader';
import {
  DOCUMENT_TOLERANCE_BASE,
  DOCUMENT_TOLERANCE_PER_ITEM,
  LINE_TOLERANCE,
  LINKABLE,
  REPROCESSABLE,
} from './fiscal-documents.constants';
import { authorizationIssue, ParsedFiscalDocument, parseNfeXml } from './nfe.parser';
import { LinkFiscalDocumentDto } from './dto/link-fiscal-document.dto';
import { QueryFiscalDocumentDto } from './dto/query-fiscal-document.dto';
import { CancelFiscalDocumentDto } from './dto/cancel-fiscal-document.dto';
import { CollectFiscalDocumentsDto } from './dto/collect-fiscal-documents.dto';

/**
 * O XML fica fora das respostas de consulta: são até 2 MB por documento, e quem
 * quer o arquivo pede o arquivo (`GET /:id/xml`).
 */
const documentOmit = { xmlContent: true } satisfies Prisma.FiscalDocumentOmit;

const documentInclude = {
  branch: { select: { id: true, code: true, name: true } },
  issuerPartner: { select: { id: true, legalName: true, tradeName: true, cnpj: true, cpf: true } },
  recipientPartner: { select: { id: true, legalName: true, tradeName: true } },
  purchaseOrder: { select: { id: true, number: true, status: true, partnerId: true } },
  duplicateOf: { select: { id: true, number: true, accessKey: true, status: true } },
  items: {
    orderBy: { sequence: 'asc' },
    include: {
      product: { select: { id: true, code: true, description: true, tracksStock: true } },
    },
  },
  receipts: {
    select: { id: true, number: true, receivedAt: true, generatedStock: true },
  },
  financialEntries: {
    select: { id: true, number: true, type: true, netAmount: true, status: true },
  },
} satisfies Prisma.FiscalDocumentInclude;

export type FiscalDocumentRow = Prisma.FiscalDocumentGetPayload<{
  include: typeof documentInclude;
  omit: typeof documentOmit;
}>;

/** O que aconteceu com um XML entregue à importação. */
export type ImportOutcome = 'IMPORTADO' | 'JA_IMPORTADO' | 'DUPLICADO' | 'ERRO';

/** Resultado de um documento do lote — `RECUSADO` é o que não pôde ser lido. */
export interface CollectItemResult {
  originReference?: string;
  outcome: ImportOutcome | 'RECUSADO';
  documentId?: string;
  number?: string;
  reason?: string;
}

export interface CollectSummary {
  received: number;
  imported: number;
  alreadyKnown: number;
  duplicates: number;
  withError: number;
  rejected: number;
  results: CollectItemResult[];
}

export interface ImportResult {
  outcome: ImportOutcome;
  document: FiscalDocumentRow;
  /** Por que o documento ficou em ERRO ou foi marcado como duplicata. */
  reason?: string;
}

export interface ImportOptions {
  origin: FiscalDocumentOrigin;
  branchId?: string;
  note?: string;
  /** Identificador na origem — chave de idempotência da coleta (RF-050). */
  originReference?: string;
  collectedAt?: Date;
}

/** Linha pronta para o INSERT, sem a empresa e o documento (postos na escrita). */
type PlannedItem = Omit<Prisma.FiscalDocumentItemCreateManyInput, 'companyId' | 'documentId'>;

/**
 * Documentos fiscais (RF-043 a RF-050) — `gestao.documento_fiscal`.
 *
 * Três decisões sustentam o módulo:
 *
 *  - **o conteúdo vem do XML, sempre.** Nenhum campo fiscal é aceito do cliente
 *    da API: número, chave, emitente, itens e valores são lidos do arquivo e
 *    conferidos contra a chave de acesso (ver `nfe.parser`). O que o cliente
 *    informa são vínculos e decisões — filial, fornecedor, pedido, produto;
 *  - **documento que não fecha entra em ERRO, não é recusado.** Perder o
 *    registro de que a nota chegou é perder justamente o que RF-049 pede para
 *    controlar. O que não fecha fica visível, sem itens e sem efeito, e o
 *    reprocessamento relê o mesmo XML;
 *  - **duplicidade convive com o original.** Arquivo idêntico é reenvio e volta
 *    o documento que já existe; chave igual com conteúdo diferente é nota
 *    reemitida ou arquivo alterado, e nasce como DUPLICADO apontando o original
 *    para que uma pessoa decida (RF-046).
 *
 * As conferências de valores repetem regras que bd/12 também aplica. A
 * duplicação é proposital: aqui elas viram status ERRO com mensagem, em vez de
 * 500 de violação de regra.
 */
@Injectable()
export class FiscalDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly references: ReferencesService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Importa um XML (RF-043 a RF-046).
   *
   * A ordem importa: identidade antes de gravar. Reconhecer o reenvio por hash
   * custa um SELECT e evita tanto o documento repetido quanto o erro de
   * constraint que abortaria a transação da requisição.
   */
  async import(
    companyId: string,
    xml: string,
    options: ImportOptions,
    userId?: string,
  ): Promise<ImportResult> {
    await this.references.assert(companyId, { branchId: options.branchId });

    const xmlHash = sha256Of(Buffer.from(xml, 'utf8'));

    const known = await this.findByIdentity(companyId, xmlHash, options.originReference);
    if (known) {
      return { outcome: 'JA_IMPORTADO', document: await this.findOne(companyId, known.id) };
    }

    const parsed = parseNfeXml(xml);
    const original = await this.findOriginal(companyId, parsed);
    const lineIssues = this.lineIssues(parsed);
    const issues = await this.inspect(companyId, parsed, lineIssues);
    const issuer = await this.resolveIssuer(companyId, parsed.issuerTaxId);

    // Duplicata tem precedência sobre o erro: o que interessa saber primeiro é
    // que este documento já existe — os valores dele são problema do original.
    const status = original
      ? FiscalDocumentStatus.DUPLICADO
      : issues.length > 0
        ? FiscalDocumentStatus.ERRO
        : FiscalDocumentStatus.PROCESSADO;

    const reason = original
      ? `Mesma chave de acesso do documento ${original.number}, com conteúdo diferente (RF-046).`
      : issues.length > 0
        ? issues.join(' ')
        : undefined;

    // Itens só entram quando as linhas fecham: bd/12 recusa linha inconsistente,
    // e o que se quer registrar do documento em ERRO é que ele chegou.
    const items =
      lineIssues.length === 0 ? await this.planItems(companyId, parsed, issuer?.id) : [];

    const created = await this.prisma.transaction(async () => {
      const document = await this.prisma.db.fiscalDocument.create({
        data: {
          companyId,
          branchId: options.branchId,
          model: parsed.model,
          accessKey: parsed.accessKey,
          number: parsed.number,
          series: parsed.series,
          operationType: parsed.operationType,
          operationNature: parsed.operationNature,
          issuedAt: parsed.issuedAt,
          movedAt: parsed.movedAt,
          issuerTaxId: parsed.issuerTaxId,
          issuerName: parsed.issuerName,
          // Fornecedor reconhecido pelo CNPJ da nota: vínculo determinístico,
          // e por isso feito aqui em vez de esperar alguém apontá-lo (RF-047).
          issuerPartnerId: issuer?.id,
          recipientTaxId: parsed.recipientTaxId,
          recipientName: parsed.recipientName,
          productsAmount: parsed.productsAmount,
          discountAmount: parsed.discountAmount,
          freightAmount: parsed.freightAmount,
          insuranceAmount: parsed.insuranceAmount,
          otherExpenseAmount: parsed.otherExpenseAmount,
          totalAmount: parsed.totalAmount,
          icmsAmount: parsed.icmsAmount,
          icmsStAmount: parsed.icmsStAmount,
          ipiAmount: parsed.ipiAmount,
          pisAmount: parsed.pisAmount,
          cofinsAmount: parsed.cofinsAmount,
          origin: options.origin,
          originReference: options.originReference,
          collectedAt: options.collectedAt,
          status,
          xmlContent: xml,
          xmlHash,
          processingError: status === FiscalDocumentStatus.ERRO ? reason : undefined,
          duplicateOfId: original?.id,
          attempts: 1,
          metadata: { ...parsed.metadata, ...(options.note ? { note: options.note } : {}) },
          createdById: userId,
          items: { create: items.map((item) => ({ companyId, ...item })) },
        },
        select: { id: true },
      });

      await this.audit.record({
        event: AuditEvent.IMPORTACAO,
        entity: AUDIT_ENTITY.FISCAL_DOCUMENT,
        entityId: document.id,
        companyId,
        note: reason ?? `Documento ${parsed.number} importado por ${options.origin}.`,
      });

      return this.findOne(companyId, document.id);
    });

    return {
      outcome:
        status === FiscalDocumentStatus.DUPLICADO
          ? 'DUPLICADO'
          : status === FiscalDocumentStatus.ERRO
            ? 'ERRO'
            : 'IMPORTADO',
      document: created,
      reason,
    };
  }

  /**
   * Importa o XML enviado no multipart (RF-043).
   *
   * O tipo declarado no upload não decide nada: `application/octet-stream` é o
   * que a maioria dos clientes manda para um `.xml`, e quem valida o conteúdo é
   * o leitor. O que se confere aqui é o que o leitor não veria — arquivo vazio,
   * tamanho e bytes binários no meio do texto.
   */
  async importUpload(
    companyId: string,
    file: UploadedFile,
    options: ImportOptions,
    userId?: string,
  ): Promise<ImportResult> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Arquivo vazio.');
    }
    if (file.buffer.length > DEFAULT_XML_LIMITS.maxBytes) {
      throw new BadRequestException(
        `XML maior que o limite de ${Math.floor(DEFAULT_XML_LIMITS.maxBytes / 1024 / 1024)} MB.`,
      );
    }
    if (file.buffer.includes(0)) {
      throw new BadRequestException('O arquivo enviado não é um XML de texto.');
    }

    // BOM antes de `<?xml` faria o leitor recusar o documento por "texto fora da
    // raiz" — e o Windows o escreve com frequência.
    const xml = file.buffer.toString('utf8').replace(/^\u{FEFF}/u, '');

    return this.import(companyId, xml, options, userId);
  }

  /**
   * Recebe um lote da integração externa (RF-050).
   *
   * Documento a documento, com o resultado de cada um na resposta: o coletor
   * precisa saber o que foi aceito para não reenviar o lote inteiro. A
   * idempotência vem de `originReference` e do hash do arquivo — reenviar é
   * seguro e devolve `JA_IMPORTADO`.
   *
   * Ressalva importante: o que é reportado por documento são as recusas
   * detectadas **antes** de gravar (XML inválido, modelo não suportado). Uma
   * rejeição do banco aborta a transação da requisição — e portanto o lote todo,
   * de propósito: requisição que falha não deixa escrita parcial (RNF-006/007).
   */
  async collect(
    companyId: string,
    dto: CollectFiscalDocumentsDto,
    userId?: string,
  ): Promise<CollectSummary> {
    const origin = dto.origin ?? FiscalDocumentOrigin.COLETA_AUTOMATICA;
    const results: CollectItemResult[] = [];

    for (const entry of dto.documents) {
      try {
        const result = await this.import(
          companyId,
          entry.xml,
          {
            origin,
            branchId: dto.branchId,
            originReference: entry.originReference,
            collectedAt: entry.collectedAt ? new Date(entry.collectedAt) : new Date(),
          },
          userId,
        );

        results.push({
          originReference: entry.originReference,
          outcome: result.outcome,
          documentId: result.document.id,
          number: result.document.number,
          reason: result.reason,
        });
      } catch (error) {
        // Recusa de leitura: registra e segue. O lote não é refém do pior
        // arquivo que ele traz.
        results.push({
          originReference: entry.originReference,
          outcome: 'RECUSADO',
          reason: error instanceof Error ? error.message : 'Falha ao ler o documento.',
        });
      }
    }

    return {
      received: dto.documents.length,
      imported: results.filter((r) => r.outcome === 'IMPORTADO').length,
      alreadyKnown: results.filter((r) => r.outcome === 'JA_IMPORTADO').length,
      duplicates: results.filter((r) => r.outcome === 'DUPLICADO').length,
      withError: results.filter((r) => r.outcome === 'ERRO').length,
      rejected: results.filter((r) => r.outcome === 'RECUSADO').length,
      results,
    };
  }

  async findAll(companyId: string, query: QueryFiscalDocumentDto) {
    const where: Prisma.FiscalDocumentWhereInput = {
      companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.model ? { model: query.model } : {}),
      ...(query.origin ? { origin: query.origin } : {}),
      ...(query.issuerPartnerId ? { issuerPartnerId: query.issuerPartnerId } : {}),
      ...(query.purchaseOrderId ? { purchaseOrderId: query.purchaseOrderId } : {}),
      // Período semiaberto (`from` inclusivo, `to` exclusivo), como no razão de
      // estoque: com `lte`, a nota emitida às 23:59:59.7 ficaria fora.
      ...(query.from || query.to
        ? {
            issuedAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lt: new Date(query.to) } : {}),
            },
          }
        : {}),
      // `AND` de dois `OR`: pendência e busca textual são filtros independentes,
      // e escrever os dois na chave `OR` faria o segundo apagar o primeiro.
      AND: [
        ...(query.pendingOnly ? [{ OR: PENDING_FILTERS }] : []),
        ...(query.q
          ? [
              {
                OR: [
                  { number: { contains: query.q, mode: Prisma.QueryMode.insensitive } },
                  { accessKey: { contains: query.q } },
                  { issuerName: { contains: query.q, mode: Prisma.QueryMode.insensitive } },
                ],
              },
            ]
          : []),
      ],
    };

    const data = await this.prisma.db.fiscalDocument.findMany({
      where,
      omit: documentOmit,
      include: documentInclude,
      orderBy: { issuedAt: 'desc' },
      skip: query.skip,
      take: query.take,
    });
    const total = await this.prisma.db.fiscalDocument.count({ where });

    return new PaginatedResult(data, total, query.page, query.pageSize);
  }

  async findOne(companyId: string, id: string): Promise<FiscalDocumentRow> {
    const document = await this.prisma.db.fiscalDocument.findFirst({
      where: { id, companyId },
      omit: documentOmit,
      include: documentInclude,
    });
    if (!document) {
      throw new NotFoundException('Documento fiscal não encontrado.');
    }
    return document;
  }

  /** XML original, para download (RF-044). */
  async readXml(companyId: string, id: string) {
    const document = await this.prisma.db.fiscalDocument.findFirst({
      where: { id, companyId },
      select: { number: true, series: true, accessKey: true, xmlContent: true },
    });
    if (!document) {
      throw new NotFoundException('Documento fiscal não encontrado.');
    }
    if (!document.xmlContent) {
      throw new NotFoundException('Este documento não tem XML armazenado.');
    }

    return {
      fileName: `${document.accessKey ?? `${document.number}-${document.series ?? '0'}`}.xml`,
      content: document.xmlContent,
    };
  }

  /**
   * Vínculos do documento (RF-047).
   *
   * Nada aqui muda o conteúdo fiscal — só a quem ele se liga. As referências são
   * conferidas dentro da empresa ativa; a coerência entre pedido e fornecedor e a
   * janela em que o item ainda aceita vínculo ficam em bd/12, que é onde valem
   * mesmo para quem não passar por este método.
   */
  async link(
    companyId: string,
    id: string,
    dto: LinkFiscalDocumentDto,
  ): Promise<FiscalDocumentRow> {
    const document = await this.findOne(companyId, id);
    if (!LINKABLE.includes(document.status)) {
      throw new ConflictException(
        `O documento ${document.number} está ${document.status} e não aceita novos vínculos (RF-047).`,
      );
    }

    await this.references.assert(companyId, {
      branchId: dto.branchId,
      supplierId: dto.issuerPartnerId,
    });
    await this.assertPurchaseOrder(companyId, dto.purchaseOrderId);

    const items = await this.planItemLinks(companyId, document, dto);

    return this.prisma.transaction(async () => {
      await this.prisma.db.fiscalDocument.update({
        where: { id },
        data: {
          ...(dto.branchId !== undefined ? { branchId: dto.branchId } : {}),
          ...(dto.issuerPartnerId !== undefined ? { issuerPartnerId: dto.issuerPartnerId } : {}),
          ...(dto.purchaseOrderId !== undefined ? { purchaseOrderId: dto.purchaseOrderId } : {}),
        },
      });

      for (const item of items) {
        await this.prisma.db.fiscalDocumentItem.update({
          where: { id: item.id },
          data: { productId: item.productId },
        });
      }

      return this.findOne(companyId, id);
    });
  }

  /**
   * Reprocessa o documento a partir do XML já guardado (RF-049).
   *
   * Relê o mesmo conteúdo — não aceita outro arquivo, e o banco também não
   * deixaria (bd/12). Serve para o caso real: a nota entrou em ERRO porque o
   * fornecedor ainda não estava cadastrado ou porque o XML chegou antes de o
   * catálogo ter o produto; corrigido o cadastro, a nota fecha.
   */
  async reprocess(companyId: string, id: string): Promise<ImportResult> {
    const current = await this.prisma.db.fiscalDocument.findFirst({
      where: { id, companyId },
      select: { number: true, status: true, xmlContent: true, attempts: true },
    });
    if (!current) {
      throw new NotFoundException('Documento fiscal não encontrado.');
    }
    if (!REPROCESSABLE.includes(current.status)) {
      throw new ConflictException(
        `O documento ${current.number} está ${current.status} e não é reprocessável (RF-049).`,
      );
    }
    if (!current.xmlContent) {
      throw new ConflictException(
        `O documento ${current.number} não tem XML armazenado: não há o que reprocessar.`,
      );
    }

    const parsed = parseNfeXml(current.xmlContent);
    const lineIssues = this.lineIssues(parsed);
    const issues = await this.inspect(companyId, parsed, lineIssues);
    const issuer = await this.resolveIssuer(companyId, parsed.issuerTaxId);
    const items =
      lineIssues.length === 0 ? await this.planItems(companyId, parsed, issuer?.id) : [];
    const reason = issues.length > 0 ? issues.join(' ') : undefined;

    const document = await this.prisma.transaction(async () => {
      // PROCESSANDO primeiro: a transição registra a tentativa na trilha e é o
      // estado em que bd/12 permite reescrever os itens.
      await this.prisma.db.fiscalDocument.update({
        where: { id },
        data: {
          status: FiscalDocumentStatus.PROCESSANDO,
          attempts: current.attempts + 1,
          processingError: null,
        },
      });

      await this.prisma.db.fiscalDocumentItem.deleteMany({ where: { documentId: id, companyId } });
      if (items.length > 0) {
        await this.prisma.db.fiscalDocumentItem.createMany({
          data: items.map((item) => ({ companyId, documentId: id, ...item })),
        });
      }

      await this.prisma.db.fiscalDocument.update({
        where: { id },
        data: {
          status: reason ? FiscalDocumentStatus.ERRO : FiscalDocumentStatus.PROCESSADO,
          processingError: reason,
          issuerPartnerId: issuer?.id,
        },
      });

      await this.audit.record({
        event: reason ? AuditEvent.ALTERACAO : AuditEvent.IMPORTACAO,
        entity: AUDIT_ENTITY.FISCAL_DOCUMENT,
        entityId: id,
        companyId,
        note: reason ?? `Documento ${parsed.number} reprocessado com sucesso.`,
      });

      return this.findOne(companyId, id);
    });

    return { outcome: reason ? 'ERRO' : 'IMPORTADO', document, reason };
  }

  /**
   * Descarta o documento (RF-049).
   *
   * Não apaga: a role da aplicação não tem DELETE sobre a tabela (bd/12). Um
   * documento que já produziu estoque ou título não é descartável — desfazer isso
   * é estorno no razão e cancelamento do título, cada um no seu módulo.
   */
  async cancel(
    companyId: string,
    id: string,
    dto: CancelFiscalDocumentDto,
  ): Promise<FiscalDocumentRow> {
    const document = await this.findOne(companyId, id);
    if (document.generatedStock || document.generatedPayable) {
      throw new ConflictException(
        `O documento ${document.number} já gerou estoque ou título: cancele o efeito no módulo de origem (RN-004).`,
      );
    }

    return this.prisma.transaction(async () => {
      await this.prisma.db.fiscalDocument.update({
        where: { id },
        data: { status: FiscalDocumentStatus.CANCELADO },
      });

      await this.audit.record({
        event: AuditEvent.CANCELAMENTO,
        entity: AUDIT_ENTITY.FISCAL_DOCUMENT,
        entityId: id,
        companyId,
        note: dto.reason,
      });

      return this.findOne(companyId, id);
    });
  }

  /**
   * Reconhece o documento já conhecido (RF-046/RF-050).
   *
   * Duas identidades, e as duas por SELECT antes de gravar: o arquivo idêntico
   * (hash) e a referência da origem, que é o que torna a coleta idempotente.
   */
  private async findByIdentity(companyId: string, xmlHash: string, originReference?: string) {
    return this.prisma.db.fiscalDocument.findFirst({
      where: {
        companyId,
        status: { not: FiscalDocumentStatus.DUPLICADO },
        OR: [{ xmlHash }, ...(originReference ? [{ originReference }] : [])],
      },
      select: { id: true, number: true },
    });
  }

  /** O original de que este documento seria duplicata (RF-046). */
  private async findOriginal(companyId: string, parsed: ParsedFiscalDocument) {
    return this.prisma.db.fiscalDocument.findFirst({
      where: {
        companyId,
        accessKey: parsed.accessKey,
        status: { not: FiscalDocumentStatus.DUPLICADO },
      },
      select: { id: true, number: true },
    });
  }

  /**
   * Tudo o que impede o documento de ser considerado processado (RF-045/RF-049).
   *
   * Devolve as mensagens em vez de lançar: o documento é gravado com elas em
   * `erro_processamento`, e é assim que a pendência aparece na consulta.
   */
  private async inspect(
    companyId: string,
    parsed: ParsedFiscalDocument,
    lineIssues: string[],
  ): Promise<string[]> {
    const issues = [...lineIssues];

    const products = parsed.items.reduce(
      (total, item) =>
        total.plus(item.lineAmount).minus(item.freightAmount).plus(item.discountAmount),
      new Prisma.Decimal(0),
    );
    const tolerance = new Prisma.Decimal(DOCUMENT_TOLERANCE_PER_ITEM)
      .times(parsed.items.length)
      .plus(DOCUMENT_TOLERANCE_BASE);
    if (products.minus(parsed.productsAmount).abs().greaterThan(tolerance)) {
      issues.push(
        `Os itens somam ${products.toFixed(2)} e a nota informa ${parsed.productsAmount.toFixed(2)} em produtos (RF-045).`,
      );
    }

    if (parsed.totalAmount.lessThanOrEqualTo(0)) {
      issues.push('A nota informa valor total zerado (RF-045).');
    }

    const authorization = authorizationIssue(parsed);
    if (authorization) {
      issues.push(authorization);
    }

    const recipient = await this.recipientIssue(companyId, parsed);
    if (recipient) {
      issues.push(recipient);
    }

    return issues;
  }

  /** Conferência da composição de cada linha — o mesmo cálculo de bd/12. */
  private lineIssues(parsed: ParsedFiscalDocument): string[] {
    const tolerance = new Prisma.Decimal(LINE_TOLERANCE);

    return parsed.items.flatMap((item) => {
      const expected = item.quantity
        .times(item.unitPrice)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
        .minus(item.discountAmount)
        .plus(item.freightAmount);

      return item.lineAmount.minus(expected).abs().greaterThan(tolerance)
        ? [
            `O item ${item.sequence} informa total ${item.lineAmount.toFixed(2)} e a composição da linha dá ${expected.toFixed(2)} (RF-045).`,
          ]
        : [];
    });
  }

  /**
   * A nota é dirigida a esta empresa? (RN-001)
   *
   * Importar para a empresa A a nota cujo destinatário é a empresa B mistura o
   * crédito de imposto e o estoque de duas contabilidades. Como o CNPJ do
   * destinatário está no XML, a conferência é barata — e o resultado é ERRO, não
   * recusa: uma filial recém-cadastrada é o caso legítimo que o reprocessamento
   * resolve.
   */
  private async recipientIssue(
    companyId: string,
    parsed: ParsedFiscalDocument,
  ): Promise<string | undefined> {
    if (!parsed.recipientTaxId) return undefined;

    const company = await this.prisma.db.company.findFirst({
      where: { id: companyId },
      select: { taxId: true, cpf: true },
    });
    const branch = await this.prisma.db.branch.findFirst({
      where: { companyId, taxId: parsed.recipientTaxId },
      select: { id: true },
    });

    const ours = [company?.taxId, company?.cpf].filter(Boolean) as string[];
    if (branch || ours.includes(parsed.recipientTaxId)) return undefined;

    return `O destinatário ${parsed.recipientTaxId} não é a empresa ativa nem uma de suas filiais (RN-001).`;
  }

  /** Fornecedor cadastrado com o CNPJ/CPF do emitente da nota (RF-047). */
  private async resolveIssuer(companyId: string, taxId: string) {
    return this.prisma.db.partner.findFirst({
      where: {
        companyId,
        isSupplier: true,
        isActive: true,
        OR: [{ cnpj: taxId }, { cpf: taxId }],
      },
      select: { id: true },
    });
  }

  /**
   * Itens prontos para o INSERT, já com o produto do catálogo quando o
   * fornecedor tem o código dele homologado (`produto_fornecedor` — RF-027).
   *
   * O vínculo automático só acontece por código homologado com **aquele**
   * fornecedor: casar por descrição ou por NCM parece prático e é como se
   * dá entrada de cimento na conta de areia.
   */
  private async planItems(
    companyId: string,
    parsed: ParsedFiscalDocument,
    issuerPartnerId?: string,
  ): Promise<PlannedItem[]> {
    const catalog = await this.supplierCatalog(companyId, parsed, issuerPartnerId);

    return parsed.items.map((item) => ({
      sequence: item.sequence,
      productId: item.supplierCode ? catalog.get(item.supplierCode) : undefined,
      supplierCode: item.supplierCode,
      description: item.description,
      ncm: item.ncm,
      cest: item.cest,
      cfop: item.cfop,
      unit: item.unit,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discountAmount: item.discountAmount,
      freightAmount: item.freightAmount,
      lineAmount: item.lineAmount,
      icmsCst: item.icmsCst,
      icmsBase: item.icmsBase,
      icmsRate: item.icmsRate,
      icmsAmount: item.icmsAmount,
      icmsStAmount: item.icmsStAmount,
      ipiAmount: item.ipiAmount,
      pisAmount: item.pisAmount,
      cofinsAmount: item.cofinsAmount,
    }));
  }

  /** Código do fornecedor → produto do catálogo, para os códigos desta nota. */
  private async supplierCatalog(
    companyId: string,
    parsed: ParsedFiscalDocument,
    issuerPartnerId?: string,
  ): Promise<Map<string, string>> {
    const codes = [...new Set(parsed.items.map((item) => item.supplierCode).filter(Boolean))];
    if (!issuerPartnerId || codes.length === 0) return new Map();

    const rows = await this.prisma.db.productSupplier.findMany({
      where: { companyId, partnerId: issuerPartnerId, supplierCode: { in: codes as string[] } },
      select: { supplierCode: true, productId: true },
    });

    return new Map(rows.map((row) => [row.supplierCode as string, row.productId]));
  }

  /** Resolve os vínculos de item pedidos, conferindo que são deste documento. */
  private async planItemLinks(
    companyId: string,
    document: FiscalDocumentRow,
    dto: LinkFiscalDocumentDto,
  ): Promise<{ id: string; productId: string | null }[]> {
    if (!dto.items?.length) return [];

    const byId = new Map(document.items.map((item) => [item.id, item]));
    const seen = new Set<string>();
    const planned: { id: string; productId: string | null }[] = [];

    for (const link of dto.items) {
      const item = byId.get(link.itemId);
      if (!item) {
        throw new BadRequestException(
          `O item informado não pertence ao documento ${document.number} (RF-047).`,
        );
      }
      if (seen.has(link.itemId)) {
        throw new BadRequestException(`O item ${item.sequence} aparece duas vezes no vínculo.`);
      }
      seen.add(link.itemId);

      await this.references.assert(companyId, { productId: link.productId });
      planned.push({ id: link.itemId, productId: link.productId ?? null });
    }

    return planned;
  }

  /** O pedido vinculado existe nesta empresa (a coerência do fornecedor é bd/12). */
  private async assertPurchaseOrder(companyId: string, purchaseOrderId?: string | null) {
    if (!purchaseOrderId) return;

    const order = await this.prisma.db.purchaseOrder.findFirst({
      where: { id: purchaseOrderId, companyId },
      select: { id: true },
    });
    if (!order) {
      throw new BadRequestException('Pedido de compra inválido para esta empresa.');
    }
  }
}

/**
 * "Ainda exige ação" (RF-049): erro de processamento, fornecedor não
 * reconhecido, item sem produto, ou nota processada que não virou estoque nem
 * título. É o mesmo conjunto de colunas da visão `vw_documento_fiscal_pendencia`.
 */
const PENDING_FILTERS: Prisma.FiscalDocumentWhereInput[] = [
  { status: FiscalDocumentStatus.ERRO },
  { status: FiscalDocumentStatus.RECEBIDO },
  { status: FiscalDocumentStatus.PROCESSADO, issuerPartnerId: null },
  { status: FiscalDocumentStatus.PROCESSADO, items: { some: { productId: null } } },
  { status: FiscalDocumentStatus.PROCESSADO, generatedStock: false },
  { status: FiscalDocumentStatus.PROCESSADO, generatedPayable: false },
];
