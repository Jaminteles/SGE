import { Injectable, Logger } from '@nestjs/common';
import { AuditEvent, OcrStatus, Prisma } from '@prisma/client';
import { AUDIT_ENTITY, AuditService } from '../../common/audit/audit.service';
import { PermanentJobError } from '../../common/queue/job.types';
import { FileStorageService } from '../../common/storage/file-storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { OcrExtractionService } from './ocr-extraction.service';
import { OcrSuggestionsService } from './ocr-suggestions.service';
import { OcrProviderResolver } from './providers/ocr-provider-resolver.service';
import { OcrProviderError } from './providers/ocr-provider.port';

/** Situações que já não pedem trabalho: o job chegou depois da decisão. */
const ALREADY_DONE: OcrStatus[] = [OcrStatus.PROCESSADO, OcrStatus.VALIDADO, OcrStatus.REJEITADO];

/**
 * Execução da leitura (RF-096, RF-097, RF-098).
 *
 * Roda no worker, dentro da transação de sistema aberta pelo runner — a empresa
 * já está na sessão de banco, e sem ela nenhuma linha responderia (RN-001).
 *
 * A ordem importa e é toda ela sobre não perder trabalho já feito:
 *
 *  1. marca `PROCESSANDO` e conta a tentativa **antes** de chamar o provedor —
 *     um processo que morre no meio da chamada precisa deixar rastro de que
 *     tentou, senão o retry parece a primeira execução;
 *  2. chama o provedor **fora** de qualquer escrita longa;
 *  3. grava texto, campos e sugestões numa transação só.
 *
 * Reentrância: um job repetido sobre um processamento já concluído sai sem
 * fazer nada. Sem isso, a segunda execução chamaria o provedor de novo — outra
 * página cobrada — e o gatilho de imutabilidade (bd/15 §6) derrubaria a
 * gravação depois do gasto.
 */
@Injectable()
export class OcrProcessingService {
  private readonly logger = new Logger(OcrProcessingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FileStorageService,
    private readonly resolver: OcrProviderResolver,
    private readonly extraction: OcrExtractionService,
    private readonly suggestions: OcrSuggestionsService,
    private readonly audit: AuditService,
  ) {}

  async run(companyId: string, processingId: string): Promise<void> {
    const processing = await this.prisma.db.ocrProcessing.findFirst({
      where: { id: processingId, companyId },
      include: {
        document: { select: { fileName: true, mimeType: true, storageKey: true } },
      },
    });

    if (!processing) {
      // O documento pode ter sido removido entre o enfileiramento e a execução.
      // Reagendar não o traz de volta.
      throw new PermanentJobError(`Processamento de OCR ${processingId} não encontrado.`);
    }
    if (ALREADY_DONE.includes(processing.status)) {
      this.logger.log(
        `Processamento ${processingId} já está em ${processing.status}; nada a fazer.`,
      );
      return;
    }

    const resolved = await this.resolver.resolve(companyId);

    await this.prisma.db.ocrProcessing.update({
      where: { id: processingId },
      data: {
        status: OcrStatus.PROCESSANDO,
        providerId: resolved.providerId,
        attempts: { increment: 1 },
        error: null,
      },
    });

    const content = await this.storage.read(processing.document.storageKey);

    let result;
    try {
      result = await resolved.provider.extract(
        {
          processingId,
          fileName: processing.document.fileName,
          mimeType: processing.document.mimeType ?? 'application/octet-stream',
          content,
        },
        resolved.context,
      );
    } catch (error) {
      await this.fail(processingId, error);
      // Falha retentável sobe para a fila reagendar com backoff (RF-070); a
      // permanente encerra aqui — a linha já está em ERRO.
      if (error instanceof OcrProviderError && !error.retryable) {
        return;
      }
      throw error;
    }

    const fields = this.extraction.extract(result.text);
    const suggestions = await this.suggestions.suggest(companyId, fields);

    await this.prisma.db.ocrProcessing.update({
      where: { id: processingId },
      data: {
        status: OcrStatus.PROCESSADO,
        extractedText: result.text.length > 0 ? result.text : null,
        confidence: result.confidence ? new Prisma.Decimal(result.confidence) : null,
        amount: fields.amount ?? null,
        issueDate: fields.issueDate ?? null,
        merchantName: fields.merchantName ?? null,
        merchantDocument: fields.merchantDocument ?? null,
        documentKey: fields.documentKey ?? null,
        documentNumber: fields.documentNumber ?? null,
        suggestedPartnerId: suggestions.partnerId ?? null,
        suggestedCategoryId: suggestions.categoryId ?? null,
        suggestedCostCenterId: suggestions.costCenterId ?? null,
        rawPayload: (result.raw ?? {}) as Prisma.InputJsonValue,
      },
    });

    await this.audit.record({
      event: AuditEvent.IMPORTACAO,
      entity: AUDIT_ENTITY.OCR_PROCESSING,
      entityId: processingId,
      companyId,
      note: `Leitura concluída por ${resolved.context.providerCode}.`,
      currentValue: {
        provider: resolved.context.providerCode,
        confidence: result.confidence ?? null,
        reasons: suggestions.reasons,
      },
    });
  }

  /**
   * Marca a falha sem perder a causa.
   *
   * O texto vai para `erro`, que a interface mostra a quem revisa; a mensagem
   * do provedor pode conter a URL cadastrada, então o detalhe cru fica no log
   * do servidor (RNF-005).
   */
  private async fail(processingId: string, error: unknown): Promise<void> {
    const message =
      error instanceof OcrProviderError
        ? `${error.code}: ${error.message}`
        : 'Falha inesperada na leitura automática.';

    this.logger.warn(`OCR ${processingId} falhou: ${String(error)}`);

    await this.prisma.db.ocrProcessing.update({
      where: { id: processingId },
      data: { status: OcrStatus.ERRO, error: message },
    });
  }
}
