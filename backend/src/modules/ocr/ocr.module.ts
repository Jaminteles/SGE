import { Module } from '@nestjs/common';

import { OcrController } from './ocr.controller';
import { OcrService } from './ocr.service';
import { OcrProcessingService } from './ocr-processing.service';
import { OcrExtractionService } from './ocr-extraction.service';
import { OcrSuggestionsService } from './ocr-suggestions.service';
import { OcrValidationService } from './ocr-validation.service';
import { OcrJobsService } from './jobs/ocr-jobs.service';
import { HttpOcrProvider } from './providers/http-ocr.provider';
import { ManualOcrProvider } from './providers/manual-ocr.provider';
import { OcrProviderResolver } from './providers/ocr-provider-resolver.service';

/**
 * M13 — OCR e Automação de Documentos (RF-095 a RF-100).
 *
 * Transforma um arquivo em uma leitura conferível: recebe (RF-095), lê no
 * worker (RF-096), extrai os campos (RF-097), propõe classificação a partir do
 * histórico do parceiro (RF-098), registra a decisão humana (RF-099) e preserva
 * documento e resultado (RF-100).
 *
 * Não importa `FinanceModule` nem `FiscalDocumentsModule`, e isso é deliberado:
 * este módulo **não lança nada**. Ele lê `parceiro` e `titulo` para sugerir, e
 * escreve apenas na própria tabela e em `documento`. Depender daqueles serviços
 * criaria um caminho pelo qual uma leitura de OCR viraria título — e aí um erro
 * de reconhecimento de caractere entraria no financeiro sem ninguém ter
 * decidido nada.
 *
 * A fila, o armazenamento e a auditoria vêm dos módulos globais `QueueModule`,
 * `StorageModule` e `AuditModule`.
 */
@Module({
  controllers: [OcrController],
  providers: [
    OcrService,
    OcrProcessingService,
    OcrExtractionService,
    OcrSuggestionsService,
    OcrValidationService,
    OcrJobsService,
    OcrProviderResolver,
    ManualOcrProvider,
    HttpOcrProvider,
  ],
  exports: [OcrExtractionService],
})
export class OcrModule {}
