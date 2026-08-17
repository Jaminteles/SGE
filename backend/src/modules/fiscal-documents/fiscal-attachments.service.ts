import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { FiscalDocumentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  FileStorageService,
  sha256Of,
  UploadedFile,
} from '../../common/storage/file-storage.service';
import {
  FiscalAttachmentCategory,
  FISCAL_ATTACHMENT_ENTITY,
  FISCAL_ATTACHMENT_SCOPE,
} from './fiscal-documents.constants';
import { FiscalDocumentsService } from './fiscal-documents.service';

/** Metadados devolvidos ao cliente — `sizeBytes` é bigint no banco. */
export interface AttachmentResponse {
  id: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  category: string | null;
  createdAt: Date;
}

/**
 * DANFE, PDF e anexos do documento fiscal (RF-048) — `gestao.documento` mais o
 * binário no storage.
 *
 * Mesma mecânica dos comprovantes de reembolso (RF-019), e pelas mesmas razões:
 * o tipo é conferido pela assinatura do conteúdo, a chave do storage é gerada
 * aqui (nunca vem do nome enviado) e o download sai sempre como `attachment` —
 * anexo nunca é renderizado no contexto da aplicação.
 *
 * O mesmo arquivo não entra duas vezes no mesmo documento: hash igual é o sinal
 * mais barato de anexo duplicado, e o índice de bd/06 existe para essa consulta.
 * Já o mesmo DANFE em documentos diferentes é permitido — nota complementar e
 * nota de origem compartilham espelho com frequência.
 */
@Injectable()
export class FiscalAttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FileStorageService,
    private readonly documents: FiscalDocumentsService,
  ) {}

  async attach(
    companyId: string,
    documentId: string,
    category: FiscalAttachmentCategory,
    file: UploadedFile,
    uploadedBy?: string,
  ): Promise<AttachmentResponse> {
    const document = await this.documents.findOne(companyId, documentId);
    if (document.status === FiscalDocumentStatus.CANCELADO) {
      throw new ConflictException(
        `O documento ${document.number} foi cancelado e não aceita novos anexos.`,
      );
    }

    // Confere o duplicado antes de gravar: um 409 não pode deixar arquivo órfão.
    const sha256 = sha256Of(file.buffer);
    const duplicate = await this.prisma.db.storedDocument.findFirst({
      where: { companyId, sha256, entity: FISCAL_ATTACHMENT_ENTITY, entityId: documentId },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException('Este arquivo já está anexado a este documento fiscal.');
    }

    const stored = await this.storage.save(companyId, FISCAL_ATTACHMENT_SCOPE, file);

    return this.prisma.transaction(async () => {
      const attachment = await this.prisma.db.storedDocument.create({
        data: {
          companyId,
          fileName: stored.fileName,
          mimeType: stored.mimeType,
          sizeBytes: BigInt(stored.sizeBytes),
          sha256: stored.sha256,
          storageProvider: stored.storageProvider,
          storageKey: stored.storageKey,
          category,
          entity: FISCAL_ATTACHMENT_ENTITY,
          entityId: documentId,
          uploadedBy,
        },
      });

      // O espelho da nota é o anexo que a interface abre por padrão: guardar a
      // chave dele no próprio documento evita uma consulta em toda listagem.
      if (category === 'DANFE') {
        await this.prisma.db.fiscalDocument.update({
          where: { id: documentId },
          data: { danfeStorageUrl: stored.storageKey },
        });
      }

      return this.toResponse(attachment);
    });
  }

  async findAll(companyId: string, documentId: string): Promise<AttachmentResponse[]> {
    // Passa pelo documento para que o 404 de outra empresa venha do documento, e
    // não de uma lista vazia de anexos.
    await this.documents.findOne(companyId, documentId);

    const attachments = await this.prisma.db.storedDocument.findMany({
      where: { companyId, entity: FISCAL_ATTACHMENT_ENTITY, entityId: documentId },
      orderBy: { createdAt: 'desc' },
    });

    return attachments.map((attachment) => this.toResponse(attachment));
  }

  /** Metadados + conteúdo, para o controller devolver o arquivo. */
  async download(companyId: string, documentId: string, attachmentId: string) {
    await this.documents.findOne(companyId, documentId);

    const attachment = await this.prisma.db.storedDocument.findFirst({
      where: {
        id: attachmentId,
        companyId,
        entity: FISCAL_ATTACHMENT_ENTITY,
        entityId: documentId,
      },
    });
    if (!attachment) {
      throw new NotFoundException('Anexo não encontrado neste documento fiscal.');
    }

    return {
      attachment: this.toResponse(attachment),
      content: await this.storage.read(attachment.storageKey),
    };
  }

  private toResponse(attachment: {
    id: string;
    fileName: string;
    mimeType: string | null;
    sizeBytes: bigint | null;
    sha256: string | null;
    category: string | null;
    createdAt: Date;
  }): AttachmentResponse {
    return {
      id: attachment.id,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes != null ? Number(attachment.sizeBytes) : null,
      sha256: attachment.sha256,
      category: attachment.category,
      createdAt: attachment.createdAt,
    };
  }
}
