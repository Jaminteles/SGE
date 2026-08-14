import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InstallmentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/paginated-result';
import { toDateOnly } from '../../common/utils/date-only';
import { UpdateInstallmentDto } from './dto/update-installment.dto';
import { QueryPortfolioDto } from './dto/query-portfolio.dto';

/** Situações em que a parcela ainda aceita ajuste e liquidação. */
export const OPEN_INSTALLMENT_STATUSES: InstallmentStatus[] = [
  InstallmentStatus.ABERTA,
  InstallmentStatus.PARCIALMENTE_LIQUIDADA,
];

/** Linha de `vw_parcela_posicao` (bd/09) — nomes de coluna do banco. */
interface PortfolioRow {
  titulo_parcela_id: string;
  titulo_id: string;
  tipo: string;
  numero: string;
  descricao: string;
  parceiro_id: string | null;
  parceiro_nome: string | null;
  categoria_financeira_id: string | null;
  centro_custo_id: string | null;
  filial_id: string | null;
  numero_parcela: number;
  total_parcelas: number;
  data_vencimento: Date;
  data_vencimento_original: Date | null;
  valor: Prisma.Decimal;
  valor_liquidado: Prisma.Decimal;
  saldo: Prisma.Decimal;
  status: string;
  dias_atraso: number;
  encargos: Prisma.Decimal;
  valor_atualizado: Prisma.Decimal;
  faixa_atraso: string;
}

/**
 * Parcelas do título (RF-053/RF-055) — `gestao.titulo_parcela`.
 *
 * O valor da parcela não é editável: alterá-lo desequilibraria a soma com o
 * valor líquido do título, que o banco confere no commit (RF-053). O que muda
 * aqui é prazo e política de cobrança — prorrogação, juros, multa e os dados do
 * boleto. O vencimento originalmente combinado é preservado pelo banco.
 *
 * A posição da carteira sai de `vw_parcela_posicao`, e não de uma conta repetida
 * aqui: dias de atraso e encargos são regra do modelo (bd/09), e duas
 * definições do mesmo número divergem na primeira mudança de política.
 */
@Injectable()
export class InstallmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async findOne(companyId: string, entryId: string, installmentId: string) {
    const installment = await this.prisma.db.financialInstallment.findFirst({
      where: { id: installmentId, companyId, entryId },
      include: {
        entry: { select: { id: true, number: true, type: true, status: true } },
        settlements: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!installment) {
      throw new NotFoundException('Parcela não encontrada neste título.');
    }
    return installment;
  }

  async update(
    companyId: string,
    entryId: string,
    installmentId: string,
    dto: UpdateInstallmentDto,
  ) {
    const current = await this.findOne(companyId, entryId, installmentId);
    if (!OPEN_INSTALLMENT_STATUSES.includes(current.status)) {
      throw new ConflictException(
        `A parcela ${current.number}/${current.totalInstallments} está ${current.status} e não aceita ajuste.`,
      );
    }

    await this.prisma.db.financialInstallment.update({
      where: { id: installmentId },
      data: {
        ...(dto.dueDate ? { dueDate: toDateOnly(dto.dueDate) } : {}),
        ...(dto.dailyInterestRate != null
          ? { dailyInterestRate: new Prisma.Decimal(dto.dailyInterestRate) }
          : {}),
        ...(dto.penaltyRate != null ? { penaltyRate: new Prisma.Decimal(dto.penaltyRate) } : {}),
        ...(dto.barcode !== undefined ? { barcode: dto.barcode } : {}),
        ...(dto.digitableLine !== undefined ? { digitableLine: dto.digitableLine } : {}),
        ...(dto.bankIdentifier !== undefined ? { bankIdentifier: dto.bankIdentifier } : {}),
        ...(dto.note !== undefined ? { note: dto.note } : {}),
      },
    });

    return this.findOne(companyId, entryId, installmentId);
  }

  /**
   * Posição da carteira (RF-055/RF-058): parcelas em aberto com dias de atraso,
   * encargos calculados e faixa de aging.
   */
  async portfolio(companyId: string, query: QueryPortfolioDto) {
    const filters = this.buildFilters(companyId, query);

    const rows = await this.prisma.db.$queryRaw<PortfolioRow[]>`
      SELECT p.*, pa.razao_social AS parceiro_nome
        FROM vw_parcela_posicao p
        LEFT JOIN parceiro pa ON pa.id = p.parceiro_id
       WHERE ${filters}
       ORDER BY p.data_vencimento, p.numero, p.numero_parcela
       LIMIT ${query.take} OFFSET ${query.skip}
    `;

    const [{ total }] = await this.prisma.db.$queryRaw<{ total: bigint }[]>`
      SELECT count(*) AS total FROM vw_parcela_posicao p WHERE ${filters}
    `;

    return new PaginatedResult(
      rows.map((row) => this.toResponse(row)),
      Number(total),
      query.page,
      query.pageSize,
    );
  }

  /**
   * Filtros compartilhados entre a listagem e a contagem: montá-los uma vez só
   * é o que garante que o total corresponde à página devolvida.
   */
  private buildFilters(companyId: string, query: QueryPortfolioDto): Prisma.Sql {
    const conditions: Prisma.Sql[] = [Prisma.sql`p.empresa_id = ${companyId}::uuid`];

    if (query.type) conditions.push(Prisma.sql`p.tipo = ${query.type}::enum_tipo_titulo`);
    if (query.partnerId) conditions.push(Prisma.sql`p.parceiro_id = ${query.partnerId}::uuid`);
    if (query.categoryId) {
      conditions.push(Prisma.sql`p.categoria_financeira_id = ${query.categoryId}::uuid`);
    }
    if (query.costCenterId) {
      conditions.push(Prisma.sql`p.centro_custo_id = ${query.costCenterId}::uuid`);
    }
    if (query.branchId) conditions.push(Prisma.sql`p.filial_id = ${query.branchId}::uuid`);
    if (query.dueFrom) conditions.push(Prisma.sql`p.data_vencimento >= ${query.dueFrom}::date`);
    if (query.dueTo) conditions.push(Prisma.sql`p.data_vencimento <= ${query.dueTo}::date`);
    if (query.overdueOnly) conditions.push(Prisma.sql`p.dias_atraso > 0`);

    return Prisma.join(conditions, ' AND ');
  }

  private toResponse(row: PortfolioRow) {
    return {
      installmentId: row.titulo_parcela_id,
      entryId: row.titulo_id,
      type: row.tipo,
      number: row.numero,
      description: row.descricao,
      partner: row.parceiro_id ? { id: row.parceiro_id, legalName: row.parceiro_nome } : null,
      installmentNumber: row.numero_parcela,
      totalInstallments: row.total_parcelas,
      dueDate: row.data_vencimento,
      originalDueDate: row.data_vencimento_original,
      amount: row.valor,
      settledAmount: row.valor_liquidado,
      balance: row.saldo,
      status: row.status,
      daysOverdue: row.dias_atraso,
      lateCharges: row.encargos,
      updatedBalance: row.valor_atualizado,
      agingBucket: row.faixa_atraso,
    };
  }
}
