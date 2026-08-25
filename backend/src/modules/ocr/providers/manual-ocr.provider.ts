import { Injectable } from '@nestjs/common';
import { OcrContext, OcrProvider, OcrRequest, OcrResult } from './ocr-provider.port';

/** Código em `gestao.provider.codigo` (bd/15 §9). */
export const MANUAL_OCR_PROVIDER_CODE = 'OCR_MANUAL';

/**
 * Adaptador da empresa que não contratou OCR (RF-096).
 *
 * Não lê nada, e é isso que ele precisa fazer: o documento é armazenado, o
 * processamento é registrado e a leitura vai direto para a pessoa (RF-099) —
 * o fluxo inteiro de M13 sem a máquina na frente. A alternativa seria recusar
 * o upload até haver integração contratada, o que deixaria o módulo inútil no
 * estado em que toda empresa começa.
 *
 * Devolve texto vazio e nenhuma confiança de propósito: um valor inventado aqui
 * seria exibido pela interface como leitura da máquina.
 */
@Injectable()
export class ManualOcrProvider implements OcrProvider {
  readonly code = MANUAL_OCR_PROVIDER_CODE;
  readonly requiresCredentials = false;

  extract(request: OcrRequest, context: OcrContext): Promise<OcrResult> {
    return Promise.resolve({
      text: '',
      raw: {
        provider: context.providerCode,
        automatic: false,
        fileName: request.fileName,
        note: 'Sem leitura automática: documento encaminhado para digitação manual (RF-099).',
      },
    });
  }
}
