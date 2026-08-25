import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditEvent, OcrStatus, Prisma } from '@prisma/client';
import { AUDIT_ENTITY, AuditService } from '../../common/audit/audit.service';
import { ReferencesService } from '../../common/references/references.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RejectOcrDto, ValidateOcrDto } from './dto/ocr.dto';
import { OcrResponse, toOcrResponse } from './ocr.mapper';
import { REVIEWABLE } from './ocr.constants';

/**
 * Validação humana da leitura (RF-099).
 *
 * Duas decisões, e as duas são registradas: `VALIDADO` diz que aquela leitura
 * pode virar lançamento, `REJEITADO` diz que não pode. Não existe uma terceira
 * — apagar não é decisão, é sumiço (bd/15 §7).
 *
 * O que a pessoa corrige entra em `correcoes`, **ao lado** do que a máquina leu,
 * nunca por cima. Sem essa separação não há como responder, depois que o
 * lançamento sai errado, se o valor veio do OCR ou de quem revisou — e essa é a
 * única pergunta útil naquele momento. O banco também recusa a sobrescrita
 * (bd/15 §6), então a regra não depende de este serviço se lembrar dela.
 *
 * Validar não lança nada. O título nasce em M08, a partir do que a pessoa
 * decidir fazer com o resultado — um OCR que lançasse sozinho transformaria
 * erro de leitura em dinheiro movimentado.
 */
@Injectable()
export class OcrValidationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly references: ReferencesService,
    private readonly audit: AuditService,
  ) {}

  async validate(
    companyId: string,
    id: string,
    dto: ValidateOcrDto,
    userId: string,
  ): Promise<OcrResponse> {
    const processing = await this.findReviewable(companyId, id);

    // Categoria, centro de custo e parceiro corrigidos precisam ser da empresa
    // ativa: sem esta checagem, trocar o id no corpo apontaria a correção para o
    // cadastro de outra empresa (a FK composta de bd/15 recusaria, mas com 500).
    await this.references.assert(companyId, {
      categoryId: dto.categoryId,
      costCenterId: dto.costCenterId,
      partnerId: dto.partnerId,
    });

    const corrections = this.buildCorrections(dto);

    return this.prisma.transaction(async () => {
      const updated = await this.prisma.db.ocrProcessing.update({
        where: { id },
        data: {
          status: OcrStatus.VALIDADO,
          validatedById: userId,
          validatedAt: new Date(),
          corrections: corrections as Prisma.InputJsonValue,
        },
        include: { document: { select: { fileName: true } } },
      });

      await this.audit.record({
        event: AuditEvent.APROVACAO,
        entity: AUDIT_ENTITY.OCR_PROCESSING,
        entityId: id,
        companyId,
        note:
          Object.keys(corrections.fields).length > 0
            ? 'Leitura validada com correções.'
            : 'Leitura validada sem correções.',
        previousValue: {
          amount: processing.amount?.toFixed(2) ?? null,
          issueDate: processing.issueDate?.toISOString().slice(0, 10) ?? null,
          merchantName: processing.merchantName,
          merchantDocument: processing.merchantDocument,
          documentNumber: processing.documentNumber,
          suggestedCategoryId: processing.suggestedCategoryId,
          suggestedCostCenterId: processing.suggestedCostCenterId,
          suggestedPartnerId: processing.suggestedPartnerId,
        },
        currentValue: corrections as Prisma.InputJsonValue,
      });

      return toOcrResponse(updated);
    });
  }

  async reject(
    companyId: string,
    id: string,
    dto: RejectOcrDto,
    userId: string,
  ): Promise<OcrResponse> {
    await this.findReviewable(companyId, id);

    return this.prisma.transaction(async () => {
      const updated = await this.prisma.db.ocrProcessing.update({
        where: { id },
        data: {
          status: OcrStatus.REJEITADO,
          validatedById: userId,
          validatedAt: new Date(),
          corrections: { rejectedReason: dto.reason } as Prisma.InputJsonValue,
        },
        include: { document: { select: { fileName: true } } },
      });

      await this.audit.record({
        event: AuditEvent.REPROVACAO,
        entity: AUDIT_ENTITY.OCR_PROCESSING,
        entityId: id,
        companyId,
        note: `Leitura rejeitada: ${dto.reason}`,
      });

      return toOcrResponse(updated);
    });
  }

  /**
   * Só `PROCESSADO` aceita decisão. Pendente ainda não tem o que revisar, e
   * validado/rejeitado é terminal — revalidar sobrescreveria a assinatura de
   * quem decidiu antes.
   */
  private async findReviewable(companyId: string, id: string) {
    const processing = await this.prisma.db.ocrProcessing.findFirst({
      where: { id, companyId },
    });
    if (!processing) {
      throw new NotFoundException('Processamento de OCR não encontrado.');
    }
    if (!REVIEWABLE.includes(processing.status)) {
      throw new ConflictException(
        `Processamento em ${processing.status} não está aguardando validação (RF-099).`,
      );
    }
    return processing;
  }

  /** Só o que foi informado vira correção — campo ausente é "estava certo". */
  private buildCorrections(dto: ValidateOcrDto): {
    fields: Record<string, string>;
    note?: string;
  } {
    const fields: Record<string, string> = {};
    const corrigible = [
      'amount',
      'issueDate',
      'merchantName',
      'merchantDocument',
      'documentNumber',
      'categoryId',
      'costCenterId',
      'partnerId',
    ] as const;

    for (const field of corrigible) {
      const value = dto[field];
      if (value !== undefined) {
        fields[field] = value;
      }
    }

    return dto.note ? { fields, note: dto.note } : { fields };
  }
}
