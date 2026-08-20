import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditEvent, Prisma, TransactionDirection } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AUDIT_ENTITY, AuditService } from '../../common/audit/audit.service';
import { PaginatedResult } from '../../common/dto/paginated-result';
import { sha256 } from '../../common/crypto/crypto.service';
import { UploadedFile } from '../../common/storage/file-storage.service';
import { toDateOnly } from '../../common/utils/date-only';
import { CompanyAccountsService } from './company-accounts.service';
import { isCnab240, parseCnab240 } from './parsers/cnab240.parser';
import { parseCsv } from './parsers/csv.parser';
import { parseOfx } from './parsers/ofx.parser';
import { ParsedStatement, StatementParseError } from './parsers/statement.types';
import {
  ImportStatementDto,
  QueryBankTransactionDto,
  QueryStatementImportDto,
  StatementFormat,
} from './dto/statement.dto';

const IMPORT_FIELDS = {
  id: true,
  bankAccountId: true,
  format: true,
  fileName: true,
  fileHash: true,
  periodStart: true,
  periodEnd: true,
  openingBalance: true,
  closingBalance: true,
  totalCount: true,
  importedCount: true,
  duplicateCount: true,
  status: true,
  error: true,
  createdAt: true,
} satisfies Prisma.BankStatementImportSelect;

const TRANSACTION_FIELDS = {
  id: true,
  bankAccountId: true,
  statementImportId: true,
  movementDate: true,
  postedDate: true,
  direction: true,
  amount: true,
  balanceAfter: true,
  description: true,
  document: true,
  externalId: true,
  counterpartName: true,
  counterpartDocument: true,
  reconciliationStatus: true,
  createdAt: true,
} satisfies Prisma.BankTransactionSelect;

/**
 * Importação e consulta de extratos (RF-060/RF-071).
 *
 * Duas deduplicações, em níveis diferentes, e as duas importam:
 *
 *  1. **o arquivo** — `uq_extrato_hash` (conta + SHA-256 do conteúdo) recusa a
 *     reimportação do mesmo arquivo. É o erro mais comum do dia a dia: baixar o
 *     extrato duas vezes e subir os dois;
 *  2. **o lançamento** — `ux_transacao_bancaria_fitid` (conta + FITID) recusa a
 *     linha repetida. É o que permite importar períodos que se sobrepõem sem
 *     duplicar movimento, que é o caso real de quem importa toda segunda-feira
 *     os últimos 15 dias.
 *
 * A importação é síncrona porque o arquivo já está em memória e o trabalho é
 * um `createMany` — enfileirar aqui só adiantaria uma resposta que já é rápida,
 * ao custo de o usuário não saber o que entrou. O teto de linhas está no
 * parser.
 *
 * O saldo da conta não é atualizado por este serviço: quem faz isso é o trigger
 * de `extrato_importacao` (bd/13 §9), e só para frente no tempo.
 */
@Injectable()
export class StatementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: CompanyAccountsService,
    private readonly audit: AuditService,
  ) {}

  async import(companyId: string, dto: ImportStatementDto, file: UploadedFile, userId: string) {
    const account = await this.accounts.findForPayment(companyId, dto.bankAccountId);

    const fileHash = sha256(file.buffer);
    const duplicate = await this.prisma.db.bankStatementImport.findFirst({
      where: { bankAccountId: account.id, fileHash },
      select: { id: true, createdAt: true },
    });
    if (duplicate) {
      throw new ConflictException(
        `Este arquivo já foi importado nesta conta em ${duplicate.createdAt.toISOString().slice(0, 10)} (${duplicate.id}).`,
      );
    }

    const format = dto.format ?? this.detectFormat(file);
    const parsed = this.parse(format, file);

    return this.prisma.transaction(async () => {
      const statement = await this.prisma.db.bankStatementImport.create({
        data: {
          companyId,
          bankAccountId: account.id,
          format,
          fileName: file.originalname?.slice(0, 255),
          fileHash,
          periodStart: parsed.periodStart ? toDateOnly(parsed.periodStart) : undefined,
          periodEnd: parsed.periodEnd ? toDateOnly(parsed.periodEnd) : undefined,
          openingBalance: parsed.openingBalance
            ? new Prisma.Decimal(parsed.openingBalance)
            : undefined,
          closingBalance: parsed.closingBalance
            ? new Prisma.Decimal(parsed.closingBalance)
            : undefined,
          totalCount: parsed.entries.length,
          status: 'PROCESSANDO',
          importedById: userId,
        },
        select: { id: true },
      });

      const { imported, duplicated } = await this.persistEntries(
        companyId,
        account.id,
        statement.id,
        parsed,
      );

      const finished = await this.prisma.db.bankStatementImport.update({
        where: { id: statement.id },
        data: { status: 'CONCLUIDO', importedCount: imported, duplicateCount: duplicated },
        select: IMPORT_FIELDS,
      });

      await this.audit.record({
        event: AuditEvent.IMPORTACAO,
        entity: AUDIT_ENTITY.BANK_STATEMENT_IMPORT,
        entityId: statement.id,
        note:
          `Extrato ${format} da conta ${account.bankCode}/${account.agency}/${account.account}: ` +
          `${imported} lançamentos importados, ${duplicated} já existentes.`,
      });

      return finished;
    });
  }

  /**
   * Grava os lançamentos ignorando os já conhecidos.
   *
   * `skipDuplicates` resolve as linhas que trazem FITID — o índice único parcial
   * as reconhece. As que não trazem identificador são conferidas uma a uma pelo
   * trio (data, sentido, valor, descrição): sem FITID não há chave natural, e
   * comparar o conteúdo é o mais próximo disso que o extrato oferece.
   */
  private async persistEntries(
    companyId: string,
    bankAccountId: string,
    statementImportId: string,
    parsed: ParsedStatement,
  ): Promise<{ imported: number; duplicated: number }> {
    const withId = parsed.entries.filter((entry) => entry.externalId);
    const withoutId = parsed.entries.filter((entry) => !entry.externalId);

    let imported = 0;

    if (withId.length > 0) {
      const created = await this.prisma.db.bankTransaction.createMany({
        data: withId.map((entry) => ({
          companyId,
          bankAccountId,
          statementImportId,
          movementDate: toDateOnly(entry.movementDate),
          postedDate: entry.postedDate ? toDateOnly(entry.postedDate) : undefined,
          direction: entry.direction as TransactionDirection,
          amount: new Prisma.Decimal(entry.amount),
          description: entry.description?.slice(0, 255),
          document: entry.document?.slice(0, 60),
          externalId: entry.externalId?.slice(0, 140),
          counterpartName: entry.counterpartName?.slice(0, 255),
        })),
        skipDuplicates: true,
      });
      imported += created.count;
    }

    for (const entry of withoutId) {
      const movementDate = toDateOnly(entry.movementDate);
      const existing = await this.prisma.db.bankTransaction.findFirst({
        where: {
          bankAccountId,
          movementDate,
          direction: entry.direction as TransactionDirection,
          amount: new Prisma.Decimal(entry.amount),
          description: entry.description?.slice(0, 255) ?? null,
        },
        select: { id: true },
      });
      if (existing) {
        continue;
      }
      await this.prisma.db.bankTransaction.create({
        data: {
          companyId,
          bankAccountId,
          statementImportId,
          movementDate,
          direction: entry.direction as TransactionDirection,
          amount: new Prisma.Decimal(entry.amount),
          description: entry.description?.slice(0, 255),
          document: entry.document?.slice(0, 60),
        },
        select: { id: true },
      });
      imported += 1;
    }

    return { imported, duplicated: parsed.entries.length - imported };
  }

  async findImports(companyId: string, query: QueryStatementImportDto) {
    const where: Prisma.BankStatementImportWhereInput = {
      companyId,
      ...(query.bankAccountId ? { bankAccountId: query.bankAccountId } : {}),
      ...(query.periodFrom ? { periodEnd: { gte: toDateOnly(query.periodFrom) } } : {}),
      ...(query.periodTo ? { periodStart: { lte: toDateOnly(query.periodTo) } } : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.db.bankStatementImport.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip: query.skip,
        take: query.take,
        select: IMPORT_FIELDS,
      }),
      this.prisma.db.bankStatementImport.count({ where }),
    ]);

    return new PaginatedResult(data, total, query.page, query.pageSize);
  }

  async findImport(companyId: string, id: string) {
    const statement = await this.prisma.db.bankStatementImport.findFirst({
      where: { id, companyId },
      select: IMPORT_FIELDS,
    });
    if (!statement) {
      throw new NotFoundException('Importação de extrato não encontrada.');
    }
    return statement;
  }

  async findTransactions(companyId: string, query: QueryBankTransactionDto) {
    const where: Prisma.BankTransactionWhereInput = {
      companyId,
      ...(query.bankAccountId ? { bankAccountId: query.bankAccountId } : {}),
      ...(query.statementImportId ? { statementImportId: query.statementImportId } : {}),
      ...(query.direction ? { direction: query.direction } : {}),
      ...(query.from || query.to
        ? {
            movementDate: {
              ...(query.from ? { gte: toDateOnly(query.from) } : {}),
              ...(query.to ? { lte: toDateOnly(query.to) } : {}),
            },
          }
        : {}),
      ...(query.q
        ? {
            OR: [
              { description: { contains: query.q, mode: 'insensitive' } },
              { document: { contains: query.q } },
              { counterpartName: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.db.bankTransaction.findMany({
        where,
        orderBy: [{ movementDate: 'desc' }, { createdAt: 'desc' }],
        skip: query.skip,
        take: query.take,
        select: TRANSACTION_FIELDS,
      }),
      this.prisma.db.bankTransaction.count({ where }),
    ]);

    return new PaginatedResult(data, total, query.page, query.pageSize);
  }

  /** Formato pelo conteúdo, e não pelo nome: extensão é palpite do cliente. */
  private detectFormat(file: UploadedFile): StatementFormat {
    const content = file.buffer.toString('utf8');
    const head = content.slice(0, 512).toUpperCase();
    if (head.includes('OFXHEADER') || head.includes('<OFX')) {
      return 'OFX';
    }
    // CNAB é posicional: o reconhecimento depende de colunas exatas do primeiro
    // registro, e não de uma palavra-chave que possa aparecer em qualquer lugar.
    if (isCnab240(content)) {
      return 'CNAB240';
    }
    return 'CSV';
  }

  private parse(format: StatementFormat, file: UploadedFile): ParsedStatement {
    const content = file.buffer.toString('utf8');
    try {
      if (format === 'OFX') {
        return parseOfx(content);
      }
      if (format === 'CNAB240') {
        return parseCnab240(content);
      }
      return parseCsv(content);
    } catch (error) {
      if (error instanceof StatementParseError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }
}
