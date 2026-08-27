import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ClassifiableSource } from './accounting.constants';
import {
  AssignLedgerAccountDto,
  ClassificationResponse,
  QueryClassificationDto,
} from './dto/classification.dto';
import { LedgerAccountsService } from './ledger-accounts.service';

/** O que a API devolve por origem, já achatado. */
interface RawClassification {
  id: string;
  code: string;
  name: string;
  ledgerAccountId: string | null;
  ledgerAccount: { code: string; name: string } | null;
}

const classificationSelect = {
  id: true,
  code: true,
  name: true,
  ledgerAccountId: true,
  ledgerAccount: { select: { code: true, name: true } },
};

/**
 * Classificação contábil das operações financeiras (RF-080).
 *
 * É aqui que o financeiro encontra a contabilidade. Três origens respondem por
 * praticamente todo lançamento automático:
 *
 *  - **categoria financeira** — a natureza da despesa ou da receita. É ela que
 *    diz em que linha da DRE o valor entra;
 *  - **conta bancária** — a conta de caixa, contrapartida de toda baixa;
 *  - **verba de folha** — salário, benefício e desconto têm contas próprias
 *    (RF-021), e agrupá-los como "despesa de pessoal" apagaria a distinção que
 *    a própria folha faz.
 *
 * A coluna `conta_contabil_id` já existe nas três tabelas desde bd/03: elas
 * pertencem a outros módulos, mas essa coluna é assunto do M11 — nenhum dos
 * outros módulos a lê. Manter a escrita aqui evita espalhar a regra de "só
 * conta analítica e ativa classifica" por três serviços.
 *
 * O limite entre empresas é duplo: a origem é buscada com `companyId` e a conta
 * também (`findPostable`). Trocar qualquer um dos dois ids na rota não alcança
 * o recurso de outra empresa, e a RLS ainda responderia vazio se alcançasse.
 */
@Injectable()
export class AccountClassificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: LedgerAccountsService,
  ) {}

  async findAll(
    companyId: string,
    source: ClassifiableSource,
    query: QueryClassificationDto,
  ): Promise<ClassificationResponse[]> {
    const where = {
      companyId,
      isActive: true,
      ...(query.unclassifiedOnly ? { ledgerAccountId: null } : {}),
    };

    const rows = await this.readSource(source, where);
    return rows.map((row) => this.toResponse(row));
  }

  /** Aponta (ou remove) a conta contábil da origem (RF-080). */
  async assign(
    companyId: string,
    source: ClassifiableSource,
    id: string,
    dto: AssignLedgerAccountDto,
  ): Promise<ClassificationResponse> {
    await this.assertSourceExists(companyId, source, id);

    if (dto.accountId) {
      const account = await this.accounts.findPostable(companyId, dto.accountId);
      if (!account) {
        // Conta inexistente, de outra empresa, inativa ou sintética: a mesma
        // resposta, porque distinguir confirmaria a existência de contas alheias.
        throw new BadRequestException(
          'Conta contábil não encontrada, inativa ou sintética. A classificação exige conta analítica ativa.',
        );
      }
    }

    const accountId = dto.accountId ?? null;

    switch (source) {
      case 'categories':
        await this.prisma.db.category.update({
          where: { id },
          data: { ledgerAccountId: accountId },
        });
        break;
      case 'payroll-items':
        await this.prisma.db.payrollItem.update({
          where: { id },
          data: { ledgerAccountId: accountId },
        });
        break;
      case 'bank-accounts':
        await this.prisma.db.companyBankAccount.update({
          where: { id },
          data: { ledgerAccountId: accountId },
        });
        break;
    }

    const [row] = await this.readSource(source, { companyId, id });
    return this.toResponse(row);
  }

  /**
   * Lê a origem pedida.
   *
   * O `switch` é explícito, e não um índice de nomes de model: o nome do model
   * viria da URL, e resolver tabela por string de requisição é como se
   * transforma um path param em acesso a qualquer tabela do schema.
   */
  private readSource(
    source: ClassifiableSource,
    where: Record<string, unknown>,
  ): Promise<RawClassification[]> {
    switch (source) {
      case 'categories':
        return this.prisma.db.category.findMany({
          where,
          orderBy: { code: 'asc' },
          select: classificationSelect,
        });
      case 'payroll-items':
        return this.prisma.db.payrollItem.findMany({
          where,
          orderBy: { code: 'asc' },
          select: classificationSelect,
        });
      case 'bank-accounts':
        // A conta bancária não tem `codigo`/`nome`: o par que a identifica é
        // banco+agência+conta, e a descrição é o nome que o usuário deu.
        return this.prisma.db.companyBankAccount
          .findMany({
            where,
            orderBy: { description: 'asc' },
            select: {
              id: true,
              bankCode: true,
              agency: true,
              account: true,
              description: true,
              ledgerAccountId: true,
              ledgerAccount: { select: { code: true, name: true } },
            },
          })
          .then((rows) =>
            rows.map((row) => ({
              id: row.id,
              code: `${row.bankCode}/${row.agency}/${row.account}`,
              name: row.description,
              ledgerAccountId: row.ledgerAccountId,
              ledgerAccount: row.ledgerAccount,
            })),
          );
    }
  }

  private async assertSourceExists(
    companyId: string,
    source: ClassifiableSource,
    id: string,
  ): Promise<void> {
    const [row] = await this.readSource(source, { companyId, id });
    if (!row) {
      throw new NotFoundException('Origem não encontrada nesta empresa.');
    }
  }

  private toResponse(row: RawClassification): ClassificationResponse {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      ledgerAccountId: row.ledgerAccountId,
      ledgerAccountCode: row.ledgerAccount?.code ?? null,
      ledgerAccountName: row.ledgerAccount?.name ?? null,
    };
  }
}
