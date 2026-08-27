import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccountNature, Prisma } from '@prisma/client';
import { PaginatedResult } from '../../common/dto/paginated-result';
import { PrismaService } from '../../prisma/prisma.service';
import { NATURE_BY_TYPE } from './accounting.constants';
import {
  CreateLedgerAccountDto,
  QueryLedgerAccountDto,
  UpdateLedgerAccountDto,
} from './dto/ledger-account.dto';

const accountSelect = {
  id: true,
  parentId: true,
  code: true,
  shortCode: true,
  name: true,
  type: true,
  nature: true,
  level: true,
  acceptsEntry: true,
  spedReferenceCode: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.LedgerAccountSelect;

export type LedgerAccountRow = Prisma.LedgerAccountGetPayload<{ select: typeof accountSelect }>;

/** Uma conta com as filhas aninhadas — o plano de contas como ele é lido. */
export interface LedgerAccountNode extends LedgerAccountRow {
  children: LedgerAccountNode[];
}

/**
 * Plano de contas (RF-078/RF-079).
 *
 * Três invariantes, e nenhuma é burocracia:
 *
 *  1. **sintética agrupa, analítica recebe**. Uma conta com filhas que aceitasse
 *     partida faria o próprio saldo ser somado duas vezes no balancete — nela e
 *     no grupo que ela representa;
 *  2. **a natureza decorre do tipo** (RF-079). Ativo, despesa e custo são
 *     devedores; passivo, patrimônio líquido e receita, credores. Só a conta de
 *     compensação escolhe, porque existe aos pares. Natureza trocada não gera
 *     erro nenhum na escrituração: inverte o sinal do saldo no balancete e na
 *     DRE, e o número errado passa por certo;
 *  3. **conta com lançamento não some**. Remover é inativar — o razão de um mês
 *     fechado não pode passar a apontar para uma conta que não existe mais.
 *
 * O banco confere as três de novo (bd/17 §2 e §3): estas checagens existem para
 * produzir mensagem legível, não para substituir a garantia.
 */
@Injectable()
export class LedgerAccountsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(companyId: string, dto: CreateLedgerAccountDto): Promise<LedgerAccountRow> {
    const nature = this.resolveNature(dto.type, dto.nature);
    const parent = dto.parentId ? await this.findEntity(companyId, dto.parentId) : null;

    if (parent) {
      if (parent.type !== dto.type) {
        throw new BadRequestException(
          `A conta pai é do tipo ${parent.type}: uma filha de tipo diferente sairia do grupo em que é somada.`,
        );
      }
      if (parent.acceptsEntry) {
        throw new BadRequestException(
          'A conta pai aceita lançamento e por isso não pode ter filhas. Desmarque `acceptsEntry` nela primeiro.',
        );
      }
    }

    try {
      return await this.prisma.db.ledgerAccount.create({
        data: {
          companyId,
          parentId: parent?.id,
          code: dto.code,
          shortCode: dto.shortCode,
          name: dto.name,
          type: dto.type,
          nature,
          // `nivel` é recalculado pelo banco a partir do pai (bd/17 §2).
          level: parent ? parent.level + 1 : 1,
          acceptsEntry: dto.acceptsEntry ?? false,
          spedReferenceCode: dto.spedReferenceCode,
        },
        select: accountSelect,
      });
    } catch (error) {
      throw this.translateUniqueness(error);
    }
  }

  async findAll(
    companyId: string,
    query: QueryLedgerAccountDto,
  ): Promise<PaginatedResult<LedgerAccountRow>> {
    const where: Prisma.LedgerAccountWhereInput = {
      companyId,
      ...(query.type ? { type: query.type } : {}),
      ...(query.acceptsEntry !== undefined ? { acceptsEntry: query.acceptsEntry } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.q
        ? {
            OR: [
              { code: { startsWith: query.q } },
              { name: { contains: query.q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.db.ledgerAccount.findMany({
        where,
        orderBy: { code: 'asc' },
        skip: query.skip,
        take: query.take,
        select: accountSelect,
      }),
      this.prisma.db.ledgerAccount.count({ where }),
    ]);

    return new PaginatedResult(rows, total, query.page, query.pageSize);
  }

  /**
   * O plano inteiro, aninhado (RF-078).
   *
   * Uma consulta só e a árvore montada em memória: descer por consultas
   * recursivas seria uma ida ao banco por nível, e o plano de contas de uma
   * empresa cabe folgado numa resposta.
   */
  async tree(companyId: string): Promise<LedgerAccountNode[]> {
    const rows = await this.prisma.db.ledgerAccount.findMany({
      where: { companyId },
      orderBy: { code: 'asc' },
      select: accountSelect,
    });

    const nodes = new Map<string, LedgerAccountNode>(
      rows.map((row) => [row.id, { ...row, children: [] }]),
    );
    const roots: LedgerAccountNode[] = [];

    for (const node of nodes.values()) {
      const parent = node.parentId ? nodes.get(node.parentId) : undefined;
      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }

  /** Uma conta da empresa ativa. Id de outra empresa é 404, não 403. */
  findOne(companyId: string, id: string): Promise<LedgerAccountRow> {
    return this.findEntity(companyId, id);
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateLedgerAccountDto,
  ): Promise<LedgerAccountRow> {
    const account = await this.findEntity(companyId, id);

    if (dto.acceptsEntry) {
      const children = await this.prisma.db.ledgerAccount.count({
        where: { companyId, parentId: id },
      });
      if (children > 0) {
        throw new BadRequestException(
          'Conta com contas filhas não recebe partida: o saldo dela seria somado duas vezes no balancete.',
        );
      }
    }

    if (dto.acceptsEntry === false || dto.isActive === false) {
      await this.assertNoLines(
        companyId,
        id,
        dto.isActive === false
          ? 'Conta com lançamento não é inativada enquanto o período não estiver fechado; ela permanece no razão.'
          : 'Conta que já recebeu partida não deixa de aceitar lançamento.',
      );
    }

    try {
      return await this.prisma.db.ledgerAccount.update({
        where: { id: account.id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.shortCode !== undefined ? { shortCode: dto.shortCode } : {}),
          ...(dto.spedReferenceCode !== undefined
            ? { spedReferenceCode: dto.spedReferenceCode }
            : {}),
          ...(dto.acceptsEntry !== undefined ? { acceptsEntry: dto.acceptsEntry } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
        select: accountSelect,
      });
    } catch (error) {
      throw this.translateUniqueness(error);
    }
  }

  /**
   * Inativa a conta. Nunca apaga: o razão de um período fechado não pode passar
   * a apontar para uma conta que não existe mais.
   */
  async deactivate(companyId: string, id: string): Promise<void> {
    await this.findEntity(companyId, id);

    const children = await this.prisma.db.ledgerAccount.count({
      where: { companyId, parentId: id, isActive: true },
    });
    if (children > 0) {
      throw new ConflictException(
        'Inative primeiro as contas filhas: um grupo inativo com filhas ativas some do plano sem tirar as filhas dele.',
      );
    }

    await this.prisma.db.ledgerAccount.update({ where: { id }, data: { isActive: false } });
  }

  /**
   * Conta analítica e ativa, para uso das contabilizações (RF-080/RF-081).
   *
   * Devolve `null` em vez de lançar: quem chama decide se a ausência é erro de
   * requisição (partida com conta inválida) ou classificação faltando.
   */
  async findPostable(companyId: string, id: string): Promise<LedgerAccountRow | null> {
    return this.prisma.db.ledgerAccount.findFirst({
      where: { id, companyId, acceptsEntry: true, isActive: true },
      select: accountSelect,
    });
  }

  private async findEntity(companyId: string, id: string): Promise<LedgerAccountRow> {
    const account = await this.prisma.db.ledgerAccount.findFirst({
      where: { id, companyId },
      select: accountSelect,
    });
    if (!account) {
      throw new NotFoundException('Conta contábil não encontrada.');
    }
    return account;
  }

  private async assertNoLines(companyId: string, id: string, message: string): Promise<void> {
    const lines = await this.prisma.db.journalEntryLine.count({
      where: { companyId, accountId: id },
    });
    if (lines > 0) {
      throw new ConflictException(message);
    }
  }

  /** RF-079: a natureza vem do tipo; só a compensação escolhe. */
  private resolveNature(
    type: CreateLedgerAccountDto['type'],
    informed?: AccountNature,
  ): AccountNature {
    const required = NATURE_BY_TYPE[type];

    if (required === null) {
      if (!informed) {
        throw new BadRequestException(
          'Conta de compensação exige `nature`: ela é a única que aceita as duas naturezas.',
        );
      }
      return informed;
    }

    if (informed && informed !== required) {
      throw new BadRequestException(
        `Conta do tipo ${type} é ${required}. Natureza trocada inverte o sinal do saldo no balancete e na DRE.`,
      );
    }
    return required;
  }

  /** A unique `uq_conta_contabil_codigo` vira uma mensagem, não um 500. */
  private translateUniqueness(error: unknown): Error {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return new ConflictException('Já existe uma conta contábil com este código.');
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}
