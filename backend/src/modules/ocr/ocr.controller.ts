import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile as UploadedFileParam,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { UploadedFile } from '../../common/storage/file-storage.service';
import { QueryOcrDto, RejectOcrDto, UploadOcrDocumentDto, ValidateOcrDto } from './dto/ocr.dto';
import { OCR_DOCUMENT_CATEGORIES } from './ocr.constants';
import { OcrService } from './ocr.service';
import { OcrValidationService } from './ocr-validation.service';

/**
 * Limite do multipart. Vem de `process.env` porque o interceptor é configurado
 * na definição da rota, antes de o ConfigService existir; o FileStorageService
 * valida o mesmo limite outra vez, já com a configuração da aplicação.
 */
const MAX_UPLOAD_BYTES = Number(process.env.UPLOAD_MAX_BYTES ?? 10 * 1024 * 1024);

/**
 * OCR e automação de documentos (RF-095 a RF-100).
 *
 * As permissões são separadas por consequência: enviar documento (`:CREATE`),
 * consultar leitura e baixar o original (`:READ`), devolver à fila (`:UPDATE`) e
 * **decidir** sobre a leitura (`:APPROVE`). A decisão é a que importa — é dela
 * que sai o lançamento adiante, e quem digitaliza nota fiscal o dia inteiro não
 * precisa ser quem assume que o valor lido está certo.
 *
 * Toda rota é escopada pela empresa ativa do header, e o id da URL é sempre
 * confrontado com ela na consulta: trocar o id não alcança o recurso de outra
 * empresa, e a RLS ainda responderia vazio se alcançasse.
 */
@ApiTags('OCR e Automação de Documentos')
@ApiBearerAuth()
@Controller('ocr')
export class OcrController {
  constructor(
    private readonly ocr: OcrService,
    private readonly validation: OcrValidationService,
  ) {}

  @Post('documents')
  @RequirePermissions(PERMISSIONS.OCR_CREATE)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        category: { type: 'string', enum: [...OCR_DOCUMENT_CATEGORIES] },
      },
    },
  })
  @ApiOperation({ summary: 'Enviar imagem ou PDF para leitura automática (RF-095)' })
  receive(
    @ActiveCompanyId() companyId: string,
    @Body() dto: UploadOcrDocumentDto,
    @UploadedFileParam() file: UploadedFile | undefined,
    @CurrentUser('id') userId: string,
  ) {
    if (!file) {
      throw new BadRequestException('Envie o arquivo no campo `file`.');
    }
    return this.ocr.receive(companyId, dto.category ?? 'COMPROVANTE', file, userId);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.OCR_READ)
  @ApiOperation({ summary: 'Listar processamentos, com filtro por situação (RF-099/RF-100)' })
  findAll(@ActiveCompanyId() companyId: string, @Query() query: QueryOcrDto) {
    return this.ocr.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.OCR_READ)
  @ApiOperation({ summary: 'Resultado da leitura: campos, sugestões e situação (RF-097/RF-098)' })
  findOne(@ActiveCompanyId() companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.ocr.findOne(companyId, id);
  }

  @Get(':id/document')
  @RequirePermissions(PERMISSIONS.OCR_READ)
  @ApiOperation({ summary: 'Baixar o documento de origem, preservado (RF-100)' })
  async download(
    @ActiveCompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() response: Response,
  ) {
    const { document, content } = await this.ocr.download(companyId, id);

    // `attachment` + nome já sanitizado: o arquivo veio de fora e nunca é
    // renderizado no contexto da aplicação.
    response.setHeader('Content-Type', document.mimeType ?? 'application/octet-stream');
    response.setHeader('Content-Disposition', `attachment; filename="${document.fileName}"`);
    response.setHeader('Content-Length', content.length);
    response.send(content);
  }

  @Post(':id/reprocess')
  @RequirePermissions(PERMISSIONS.OCR_UPDATE)
  @ApiOperation({ summary: 'Devolver à fila um processamento que falhou (RF-096)' })
  reprocess(@ActiveCompanyId() companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.ocr.reprocess(companyId, id);
  }

  @Post(':id/validate')
  @RequirePermissions(PERMISSIONS.OCR_APPROVE)
  @ApiOperation({ summary: 'Validar a leitura, com ou sem correções (RF-099)' })
  validate(
    @ActiveCompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ValidateOcrDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.validation.validate(companyId, id, dto, userId);
  }

  @Post(':id/reject')
  @RequirePermissions(PERMISSIONS.OCR_APPROVE)
  @ApiOperation({ summary: 'Rejeitar a leitura, com motivo (RF-099)' })
  reject(
    @ActiveCompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectOcrDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.validation.reject(companyId, id, dto, userId);
  }
}
