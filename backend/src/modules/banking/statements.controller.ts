import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile as UploadedFileParam,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { UploadedFile } from '../../common/storage/file-storage.service';
import { StatementsService } from './statements.service';
import {
  ImportStatementDto,
  STATEMENT_FORMATS,
  QueryBankTransactionDto,
  QueryStatementImportDto,
} from './dto/statement.dto';

/** Extrato é texto: 10 MB cobrem um ano de conta movimentada. */
const MAX_STATEMENT_BYTES = 10 * 1024 * 1024;

/**
 * Extratos bancários (RF-060).
 *
 * Importar tem permissão própria e separada da leitura: o extrato move o saldo
 * da conta (bd/13 §9) e é a base da conciliação (M10).
 */
@ApiTags('Bancos — Extratos')
@ApiBearerAuth()
@Controller('banking')
export class StatementsController {
  constructor(private readonly statements: StatementsService) {}

  @Post('statements/import')
  @RequirePermissions(PERMISSIONS.BANK_STATEMENTS_CREATE)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_STATEMENT_BYTES, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'bankAccountId'],
      properties: {
        file: { type: 'string', format: 'binary' },
        bankAccountId: { type: 'string', format: 'uuid' },
        format: { type: 'string', enum: [...STATEMENT_FORMATS] },
      },
    },
  })
  @ApiOperation({
    summary: 'Importar extrato OFX, CSV ou CNAB 240, sem duplicar lançamentos (RF-060/RF-071)',
  })
  import(
    @ActiveCompanyId() companyId: string,
    @Body() dto: ImportStatementDto,
    @UploadedFileParam() file: UploadedFile | undefined,
    @CurrentUser('id') userId: string,
  ) {
    if (!file || file.size === 0) {
      throw new BadRequestException('Envie o arquivo do extrato no campo `file`.');
    }
    return this.statements.import(companyId, dto, file, userId);
  }

  @Get('statements')
  @RequirePermissions(PERMISSIONS.BANK_STATEMENTS_READ)
  @ApiOperation({ summary: 'Listar importações de extrato (paginado)' })
  findImports(@ActiveCompanyId() companyId: string, @Query() query: QueryStatementImportDto) {
    return this.statements.findImports(companyId, query);
  }

  @Get('statements/:id')
  @RequirePermissions(PERMISSIONS.BANK_STATEMENTS_READ)
  @ApiOperation({ summary: 'Detalhar uma importação, com contagens e período' })
  findImport(@ActiveCompanyId() companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.statements.findImport(companyId, id);
  }

  @Get('bank-transactions')
  @RequirePermissions(PERMISSIONS.BANK_STATEMENTS_READ)
  @ApiOperation({ summary: 'Consultar movimentos bancários importados (paginado) — RF-060' })
  findTransactions(@ActiveCompanyId() companyId: string, @Query() query: QueryBankTransactionDto) {
    return this.statements.findTransactions(companyId, query);
  }
}
