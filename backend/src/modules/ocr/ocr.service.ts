import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { OcrStatus } from '@prisma/client';
import { PaginatedResult } from '../../common/dto/paginated-result';
import { JobQueueService } from '../../common/queue/job-queue.service';
import { QUEUES } from '../../common/queue/job.types';
import {
  FileStorageService,
  sha256Of,
  UploadedFile,
} from '../../common/storage/file-storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { QueryOcrDto } from './dto/ocr.dto';
import { OcrResponse, toOcrResponse } from './ocr.mapper';
import {
  OCR_DOCUMENT_ENTITY,
  OCR_JOBS,
  OCR_STORAGE_SCOPE,
  OcrDocumentCategory,
  MAX_ATTEMPTS,
  REPROCESSABLE,
} from './ocr.constants';

/**
 * Recepção de imagens e PDFs para leitura automática (RF-095, RF-100).
 *
 * O arquivo entra pelo mesmo caminho dos comprovantes de reembolso e dos anexos
 * de nota: tipo conferido pela assinatura do conteúdo, chave de storage gerada
 * aqui (nunca vinda do nome enviado) e download sempre como `attachment` —
 * documento de OCR é arquivo de origem desconhecida por definição, e nunca é
 * renderizado no contexto da aplicação.
 *
 * O mesmo arquivo enviado duas vezes é um processamento só. A dedupe é por
 * hash, conferida **antes** de gravar (um 409 não pode deixar arquivo órfão no
 * storage) e sustentada pela unique `uq_ocr_documento` do banco, que é onde
 * duas requisições simultâneas se encontram.
 *
 * Ler é enfileirar, não processar: a leitura acontece no worker (RF-096). O
 * enfileiramento participa da transação da requisição — o job não existe se o
 * upload não tiver sido confirmado.
 */
@Injectable()
export class OcrService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FileStorageService,
    private readonly queue: JobQueueService,
  ) {}

  async receive(
    companyId: string,
    category: OcrDocumentCategory,
    file: UploadedFile,
    uploadedBy: string,
  ): Promise<OcrResponse> {
    const sha256 = sha256Of(file.buffer);

    const existing = await this.prisma.db.ocrProcessing.findFirst({
      where: { companyId, document: { sha256, entity: OCR_DOCUMENT_ENTITY } },
      include: { document: { select: { fileName: true } } },
    });
    if (existing) {
      // Reenvio do mesmo arquivo devolve o processamento que já existe, em vez
      // de 409: o cliente que repetiu por timeout precisa do id, não de um erro.
      return toOcrResponse(existing);
    }

    const stored = await this.storage.save(companyId, OCR_STORAGE_SCOPE, file);

    return this.prisma.transaction(async () => {
      const document = await this.prisma.db.storedDocument.create({
        data: {
          companyId,
          fileName: stored.fileName,
          mimeType: stored.mimeType,
          sizeBytes: BigInt(stored.sizeBytes),
          sha256: stored.sha256,
          storageProvider: stored.storageProvider,
          storageKey: stored.storageKey,
          category,
          entity: OCR_DOCUMENT_ENTITY,
          uploadedBy,
        },
        select: { id: true, fileName: true },
      });

      const processing = await this.prisma.db.ocrProcessing.create({
        data: { companyId, documentId: document.id, status: OcrStatus.PENDENTE },
      });

      // `entidade_id` só existe depois que o processamento existe: o documento é
      // criado primeiro porque é ele que o processamento referencia.
      await this.prisma.db.storedDocument.update({
        where: { id: document.id },
        data: { entityId: processing.id },
      });

      await this.enqueue(companyId, processing.id);

      return toOcrResponse({ ...processing, document: { fileName: document.fileName } });
    });
  }

  async findAll(companyId: string, query: QueryOcrDto): Promise<PaginatedResult<OcrResponse>> {
    const where = {
      companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.q ? { merchantName: { contains: query.q, mode: 'insensitive' as const } } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.db.ocrProcessing.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.take,
        include: { document: { select: { fileName: true } } },
      }),
      this.prisma.db.ocrProcessing.count({ where }),
    ]);

    return new PaginatedResult(rows.map(toOcrResponse), total, query.page, query.pageSize);
  }

  /** Um processamento da empresa ativa. Id de outra empresa é 404, não 403. */
  async findOne(companyId: string, id: string): Promise<OcrResponse> {
    return toOcrResponse(await this.findEntity(companyId, id));
  }

  /** Documento de origem, preservado junto do resultado (RF-100). */
  async download(companyId: string, id: string) {
    const processing = await this.prisma.db.ocrProcessing.findFirst({
      where: { id, companyId },
      include: {
        document: { select: { fileName: true, mimeType: true, storageKey: true } },
      },
    });
    if (!processing) {
      throw new NotFoundException('Processamento de OCR não encontrado.');
    }

    return {
      document: processing.document,
      content: await this.storage.read(processing.document.storageKey),
    };
  }

  /**
   * Devolve à fila um processamento que falhou (RF-096).
   *
   * Só `ERRO` volta: reprocessar um resultado já lido trocaria, por baixo, o
   * texto que a revisão humana está olhando — e a decisão registrada passaria a
   * se referir a algo que não existe mais (bd/15 §4).
   */
  async reprocess(companyId: string, id: string): Promise<OcrResponse> {
    const processing = await this.findEntity(companyId, id);
    if (!REPROCESSABLE.includes(processing.status)) {
      throw new ConflictException(
        `Processamento em ${processing.status} não volta para a fila (RF-096).`,
      );
    }
    // O CHECK do banco recusaria a tentativa 21 com 500; aqui a recusa tem
    // mensagem e diz o que fazer em vez disso.
    if (processing.attempts >= MAX_ATTEMPTS) {
      throw new ConflictException(
        `Documento já passou por ${MAX_ATTEMPTS} tentativas de leitura; siga pela digitação manual (RF-099).`,
      );
    }

    return this.prisma.transaction(async () => {
      const updated = await this.prisma.db.ocrProcessing.update({
        where: { id },
        data: { status: OcrStatus.PENDENTE, error: null },
        include: { document: { select: { fileName: true } } },
      });
      await this.enqueue(companyId, id);
      return toOcrResponse(updated);
    });
  }

  private async findEntity(companyId: string, id: string) {
    const processing = await this.prisma.db.ocrProcessing.findFirst({
      where: { id, companyId },
      include: { document: { select: { fileName: true } } },
    });
    if (!processing) {
      throw new NotFoundException('Processamento de OCR não encontrado.');
    }
    return processing;
  }

  /**
   * Enfileira a leitura. A chave de idempotência é o próprio processamento:
   * pedir de novo enquanto o primeiro job vive é pedir o mesmo job — e, num
   * provedor que cobra por página, seria a segunda cobrança do mesmo arquivo.
   */
  private async enqueue(companyId: string, processingId: string): Promise<void> {
    await this.queue.enqueue({
      queue: QUEUES.OCR,
      name: OCR_JOBS.PROCESS,
      companyId,
      payload: { processingId },
      idempotencyKey: `ocr:${processingId}`,
    });
  }
}
