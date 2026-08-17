import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile as UploadedFileParam,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FiscalDocumentOrigin } from '@prisma/client';
import { Response } from 'express';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { UploadedFile } from '../../common/storage/file-storage.service';
import { DEFAULT_XML_LIMITS } from '../../common/xml/xml-reader';
import { FiscalDocumentsService } from './fiscal-documents.service';
import { FiscalPostingsService } from './fiscal-postings.service';
import { ImportFiscalDocumentDto } from './dto/import-fiscal-document.dto';
import { CollectFiscalDocumentsDto } from './dto/collect-fiscal-documents.dto';
import { QueryFiscalDocumentDto } from './dto/query-fiscal-document.dto';
import { LinkFiscalDocumentDto } from './dto/link-fiscal-document.dto';
import { PostFiscalDocumentDto } from './dto/post-fiscal-document.dto';
import { CancelFiscalDocumentDto } from './dto/cancel-fiscal-document.dto';

/**
 * Documentos fiscais (RF-043 a RF-050).
 *
 * Não há `PUT`/`DELETE`: nota é documento de terceiro. O conteúdo fiscal não se
 * edita (bd/12 recusa), o que existe é `PATCH /:id/links` para os vínculos,
 * `POST /:id/reprocess` para reler o mesmo XML e `POST /:id/cancel` para
 * descartar com motivo. Dar entrada no estoque e assumir a conta a pagar têm
 * permissão própria (`fiscal-postings:CREATE`), porque é ali que a nota vira
 * mercadoria e dinheiro.
 */
@ApiTags('Documentos Fiscais')
@ApiBearerAuth()
@Controller('fiscal-documents')
export class FiscalDocumentsController {
  constructor(
    private readonly documents: FiscalDocumentsService,
    private readonly postings: FiscalPostingsService,
  ) {}

  @Post('import')
  @RequirePermissions(PERMISSIONS.FISCAL_DOCUMENTS_CREATE)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: DEFAULT_XML_LIMITS.maxBytes, files: 1 } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        branchId: { type: 'string', format: 'uuid' },
        note: { type: 'string' },
      },
    },
  })
  @ApiOperation({
    summary: 'Importar XML de NF-e/NFC-e — grava o original e processa (RF-043 a RF-046)',
  })
  import(
    @ActiveCompanyId() companyId: string,
    @Body() dto: ImportFiscalDocumentDto,
    @UploadedFileParam() file: UploadedFile | undefined,
    @CurrentUser('id') userId: string,
  ) {
    if (!file) {
      throw new BadRequestException('Envie o XML no campo `file`.');
    }
    return this.documents.importUpload(
      companyId,
      file,
      { origin: FiscalDocumentOrigin.UPLOAD_MANUAL, branchId: dto.branchId, note: dto.note },
      userId,
    );
  }

  @Post('collect')
  @RequirePermissions(PERMISSIONS.FISCAL_DOCUMENTS_CREATE)
  @ApiOperation({
    summary: 'Receber lote de documentos de integração externa, idempotente (RF-050)',
  })
  collect(
    @ActiveCompanyId() companyId: string,
    @Body() dto: CollectFiscalDocumentsDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.documents.collect(companyId, dto, userId);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.FISCAL_DOCUMENTS_READ)
  @ApiOperation({ summary: 'Consultar documentos fiscais (paginado, com filtros) — RF-045/RF-049' })
  findAll(@ActiveCompanyId() companyId: string, @Query() query: QueryFiscalDocumentDto) {
    return this.documents.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.FISCAL_DOCUMENTS_READ)
  @ApiOperation({ summary: 'Detalhar documento com itens, vínculos e efeitos' })
  findOne(@ActiveCompanyId() companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.documents.findOne(companyId, id);
  }

  @Get(':id/xml')
  @RequirePermissions(PERMISSIONS.FISCAL_DOCUMENTS_READ)
  @ApiOperation({ summary: 'Baixar o XML original, como recebido (RF-044)' })
  async downloadXml(
    @ActiveCompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() response: Response,
  ) {
    const { fileName, content } = await this.documents.readXml(companyId, id);

    // `attachment`: o XML nunca é renderizado no contexto da aplicação.
    response.setHeader('Content-Type', 'application/xml; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    response.send(content);
  }

  @Patch(':id/links')
  @RequirePermissions(PERMISSIONS.FISCAL_DOCUMENTS_UPDATE)
  @ApiOperation({
    summary: 'Vincular fornecedor, pedido, filial e produtos dos itens (RF-047)',
  })
  link(
    @ActiveCompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LinkFiscalDocumentDto,
  ) {
    return this.documents.link(companyId, id, dto);
  }

  @Post(':id/reprocess')
  @RequirePermissions(PERMISSIONS.FISCAL_DOCUMENTS_UPDATE)
  @ApiOperation({ summary: 'Reprocessar o XML já armazenado (RF-049)' })
  reprocess(@ActiveCompanyId() companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.documents.reprocess(companyId, id);
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.FISCAL_DOCUMENTS_DELETE)
  @ApiOperation({ summary: 'Descartar o documento — exige motivo e nenhum efeito gerado (RF-049)' })
  cancel(
    @ActiveCompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelFiscalDocumentDto,
  ) {
    return this.documents.cancel(companyId, id, dto);
  }

  @Post(':id/postings')
  @RequirePermissions(PERMISSIONS.FISCAL_POSTINGS_CREATE)
  @ApiOperation({
    summary: 'Gerar entrada de estoque e/ou título a pagar a partir da nota (RF-047)',
  })
  postEffects(
    @ActiveCompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PostFiscalDocumentDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.postings.post(companyId, id, dto, userId);
  }
}
