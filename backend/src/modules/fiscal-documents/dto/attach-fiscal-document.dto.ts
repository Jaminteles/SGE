import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import {
  FiscalAttachmentCategory,
  FISCAL_ATTACHMENT_CATEGORIES,
} from '../fiscal-documents.constants';

/** Campos que acompanham o anexo (RF-048). */
export class AttachFiscalDocumentDto {
  @ApiPropertyOptional({
    enum: FISCAL_ATTACHMENT_CATEGORIES,
    description: 'DANFE é o espelho da nota; ANEXO é o resto. Padrão: DANFE',
  })
  @IsOptional()
  @IsIn(FISCAL_ATTACHMENT_CATEGORIES)
  category?: FiscalAttachmentCategory;
}
