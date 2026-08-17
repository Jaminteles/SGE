import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UploadedFile as UploadedFileParam,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { UploadedFile } from '../../common/storage/file-storage.service';
import { FiscalAttachmentsService } from './fiscal-attachments.service';
import { AttachFiscalDocumentDto } from './dto/attach-fiscal-document.dto';

/**
 * Limite do multipart. Vem de `process.env` porque o interceptor é configurado
 * na definição da rota, antes de o ConfigService existir; o FileStorageService
 * valida o mesmo limite outra vez, já com a configuração da aplicação.
 */
const MAX_UPLOAD_BYTES = Number(process.env.UPLOAD_MAX_BYTES ?? 10 * 1024 * 1024);

/** DANFE, PDF e anexos do documento fiscal (RF-048). */
@ApiTags('Documentos Fiscais — Anexos')
@ApiBearerAuth()
@Controller('fiscal-documents/:documentId/attachments')
export class FiscalAttachmentsController {
  constructor(private readonly attachments: FiscalAttachmentsService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.FISCAL_DOCUMENTS_UPDATE)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        category: { type: 'string', enum: ['DANFE', 'ANEXO'] },
      },
    },
  })
  @ApiOperation({ summary: 'Anexar DANFE/PDF ou documento relacionado (RF-048)' })
  attach(
    @ActiveCompanyId() companyId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() dto: AttachFiscalDocumentDto,
    @UploadedFileParam() file: UploadedFile | undefined,
    @CurrentUser('id') userId: string,
  ) {
    if (!file) {
      throw new BadRequestException('Envie o arquivo no campo `file`.');
    }
    return this.attachments.attach(companyId, documentId, dto.category ?? 'DANFE', file, userId);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.FISCAL_DOCUMENTS_READ)
  @ApiOperation({ summary: 'Listar anexos do documento fiscal (RF-048)' })
  findAll(
    @ActiveCompanyId() companyId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return this.attachments.findAll(companyId, documentId);
  }

  @Get(':attachmentId')
  @RequirePermissions(PERMISSIONS.FISCAL_DOCUMENTS_READ)
  @ApiOperation({ summary: 'Baixar um anexo do documento fiscal (RF-048)' })
  async download(
    @ActiveCompanyId() companyId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @Res() response: Response,
  ) {
    const { attachment, content } = await this.attachments.download(
      companyId,
      documentId,
      attachmentId,
    );

    // `attachment` + nome já sanitizado: o arquivo nunca é renderizado no
    // contexto da aplicação, mesmo que alguém consiga guardar algo hostil.
    response.setHeader('Content-Type', attachment.mimeType ?? 'application/octet-stream');
    response.setHeader('Content-Disposition', `attachment; filename="${attachment.fileName}"`);
    response.setHeader('Content-Length', content.length);
    response.send(content);
  }
}
