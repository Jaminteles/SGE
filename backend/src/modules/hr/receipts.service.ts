import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ReimbursementStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  FileStorageService,
  sha256Of,
  UploadedFile,
} from '../../common/storage/file-storage.service';
import { ReimbursementsService } from './reimbursements.service';

/** Situações em que a solicitação ainda aceita anexos. */
const EDITABLE: ReimbursementStatus[] = [
  ReimbursementStatus.RASCUNHO,
  ReimbursementStatus.SOLICITADO,
  ReimbursementStatus.EM_ANALISE,
];

/** Categoria gravada em `documento.categoria`. */
const RECEIPT_CATEGORY = 'COMPROVANTE';
const RECEIPT_ENTITY = 'reembolso_item';

/**
 * Comprovantes de despesa (RF-019) — `gestao.documento` + o binário no storage.
 *
 * O mesmo arquivo enviado duas vezes é recusado: hash igual dentro da empresa é
 * o sinal mais barato de despesa lançada em duplicidade, e o índice de bd/06
 * existe justamente para essa consulta.
 */
@Injectable()
export class ReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FileStorageService,
    private readonly reimbursements: ReimbursementsService,
  ) {}

  async attach(
    companyId: string,
    reimbursementId: string,
    itemId: string,
    file: UploadedFile,
    uploadedBy?: string,
  ) {
    const item = await this.loadItem(companyId, reimbursementId, itemId);
    if (item.documentId) {
      throw new ConflictException('A despesa já possui comprovante.');
    }

    // Confere o duplicado antes de gravar: um 409 não pode deixar arquivo órfão.
    const sha256 = sha256Of(file.buffer);
    const duplicate = await this.prisma.db.storedDocument.findFirst({
      where: { companyId, sha256, category: RECEIPT_CATEGORY },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException('Este comprovante já foi anexado a outra despesa.');
    }

    const stored = await this.storage.save(companyId, 'comprovantes', file);

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
          category: RECEIPT_CATEGORY,
          entity: RECEIPT_ENTITY,
          entityId: itemId,
          uploadedBy,
        },
      });

      await this.prisma.db.reimbursementItem.update({
        where: { id: itemId },
        data: { documentId: document.id },
      });

      return this.toResponse(document);
    });
  }

  /** Metadados + conteúdo, para o controller devolver o arquivo. */
  async download(companyId: string, reimbursementId: string, itemId: string) {
    const item = await this.loadItem(companyId, reimbursementId, itemId, false);
    if (!item.documentId) {
      throw new NotFoundException('A despesa não possui comprovante.');
    }

    const document = await this.prisma.db.storedDocument.findFirst({
      where: { id: item.documentId, companyId },
    });
    if (!document) {
      throw new NotFoundException('Comprovante não encontrado.');
    }

    return {
      document: this.toResponse(document),
      content: await this.storage.read(document.storageKey),
    };
  }

  /**
   * Localiza o item dentro do reembolso da empresa ativa.
   * `requireEditable` distingue anexar (muda o item) de baixar (só lê).
   */
  private async loadItem(
    companyId: string,
    reimbursementId: string,
    itemId: string,
    requireEditable = true,
  ) {
    const reimbursement = await this.reimbursements.findOne(companyId, reimbursementId);
    if (requireEditable && !EDITABLE.includes(reimbursement.status)) {
      throw new ConflictException(`Reembolso ${reimbursement.status} não aceita novos anexos.`);
    }

    const item = reimbursement.items.find((row) => row.id === itemId);
    if (!item) {
      throw new NotFoundException('Despesa não encontrada neste reembolso.');
    }
    return item;
  }

  /** `sizeBytes` é bigint no banco e JSON.stringify não serializa BigInt. */
  private toResponse(document: {
    id: string;
    fileName: string;
    mimeType: string | null;
    sizeBytes: bigint | null;
    sha256: string | null;
    storageKey: string;
    createdAt: Date;
  }) {
    return {
      id: document.id,
      fileName: document.fileName,
      mimeType: document.mimeType,
      sizeBytes: document.sizeBytes != null ? Number(document.sizeBytes) : null,
      sha256: document.sha256,
      createdAt: document.createdAt,
    };
  }
}
