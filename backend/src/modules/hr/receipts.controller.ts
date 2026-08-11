import {
  BadRequestException,
  Controller,
  Get,
  Param,
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
import { ReceiptsService } from './receipts.service';

/**
 * Limite do multipart. Vem de `process.env` porque o interceptor é configurado
 * na definição da rota, antes de o ConfigService existir; o FileStorageService
 * valida o mesmo limite outra vez, já com a configuração da aplicação.
 */
const MAX_UPLOAD_BYTES = Number(process.env.UPLOAD_MAX_BYTES ?? 10 * 1024 * 1024);

@ApiTags('RH — Comprovantes')
@ApiBearerAuth()
@Controller('reimbursements/:reimbursementId/items/:itemId/receipt')
export class ReceiptsController {
  constructor(private readonly receipts: ReceiptsService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.REIMBURSEMENTS_UPDATE)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @ApiOperation({ summary: 'Anexar comprovante da despesa — PDF, JPEG ou PNG (RF-019)' })
  attach(
    @ActiveCompanyId() companyId: string,
    @Param('reimbursementId') reimbursementId: string,
    @Param('itemId') itemId: string,
    @UploadedFileParam() file: UploadedFile | undefined,
    @CurrentUser('id') userId: string,
  ) {
    if (!file) {
      throw new BadRequestException('Envie o arquivo no campo `file`.');
    }
    return this.receipts.attach(companyId, reimbursementId, itemId, file, userId);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.REIMBURSEMENTS_READ)
  @ApiOperation({ summary: 'Baixar o comprovante da despesa (RF-019)' })
  async download(
    @ActiveCompanyId() companyId: string,
    @Param('reimbursementId') reimbursementId: string,
    @Param('itemId') itemId: string,
    @Res() response: Response,
  ) {
    const { document, content } = await this.receipts.download(companyId, reimbursementId, itemId);

    // `attachment` + nome já sanitizado: o comprovante nunca é renderizado no
    // contexto da aplicação, mesmo que alguém consiga guardar um arquivo hostil.
    response.setHeader('Content-Type', document.mimeType ?? 'application/octet-stream');
    response.setHeader('Content-Disposition', `attachment; filename="${document.fileName}"`);
    response.setHeader('Content-Length', content.length);
    response.send(content);
  }
}
