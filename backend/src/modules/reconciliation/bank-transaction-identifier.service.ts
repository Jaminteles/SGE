import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TransactionDirection } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Natureza reconhecida no histórico do extrato (RF-072). */
export type BankTransactionKind =
  | 'PIX'
  | 'TED'
  | 'DOC'
  | 'BOLETO'
  | 'TARIFA'
  | 'RENDIMENTO'
  | 'IMPOSTO'
  | 'ESTORNO'
  | 'TRANSFERENCIA_INTERNA'
  | 'OUTRO';

/**
 * O que se conseguiu extrair da linha do extrato, sem consultar o banco de
 * dados. Separado do serviço para poder ser testado como função pura — a
 * classificação é regra de negócio densa e é onde os erros aparecem.
 */
export interface BankTransactionSignals {
  kind: BankTransactionKind;
  /** CPF/CNPJ encontrado no histórico ou no campo de contraparte, só dígitos. */
  document?: string;
  /** Nosso número / código de barras aparente, quando o histórico traz. */
  reference?: string;
  /** Nome provável da contraparte, normalizado. */
  counterpartName?: string;
}

/** Identificação completa: sinais do texto mais o que o cadastro confirmou. */
export interface BankTransactionIdentification extends BankTransactionSignals {
  partnerId?: string;
  partnerName?: string;
  /** Conta da própria empresa: o movimento é transferência entre contas nossas. */
  internalAccountId?: string;
  identifiedAt: string;
}

/** Palavra-chave → natureza. Ordem importa: a primeira que casa decide. */
const KIND_PATTERNS: [BankTransactionKind, RegExp][] = [
  ['ESTORNO', /\b(ESTORNO|DEVOLUCAO|DEVOLVIDO|CHARGEBACK)\b/],
  ['TARIFA', /\b(TARIFA|TAR |CESTA|MANUTENCAO DE CONTA|IOF|PACOTE DE SERVICOS)\b/],
  ['RENDIMENTO', /\b(RENDIMENTO|REND\.?|JUROS CREDITADOS|APLICACAO AUTOMATICA|RESGATE)\b/],
  ['IMPOSTO', /\b(DARF|DAS |GPS |FGTS|GARE|IRRF|TRIBUTO|IMPOSTO)\b/],
  ['PIX', /\bPIX\b/],
  ['BOLETO', /\b(BOLETO|COBRANCA|TITULO|LIQUIDACAO DE TITULO|BLQ)\b/],
  ['TED', /\bTED\b/],
  ['DOC', /\bDOC\b/],
  ['TRANSFERENCIA_INTERNA', /\b(TRANSF(ERENCIA)? ENTRE CONTAS|TRANSF\.? MESMA TITULARIDADE)\b/],
];

/** Documento com 11 ou 14 dígitos, com ou sem máscara. */
const DOCUMENT_PATTERN = /(\d{3}\.?\d{3}\.?\d{3}-?\d{2}|\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})/;

/** Nosso número/identificador longo que bancos colam no histórico. */
const REFERENCE_PATTERN = /\b(\d{8,20})\b/;

/**
 * Lê o histórico do extrato e diz o que aquele movimento parece ser (RF-072).
 *
 * Função pura e sem acesso ao banco: recebe o texto do extrato e devolve
 * sinais. O que ela **não** faz é decidir conciliação — um movimento
 * classificado como TARIFA continua precisando de alguém, ou de uma regra
 * explícita, para sair de NAO_CONCILIADO. Classificar é reduzir o trabalho de
 * quem concilia, não substituí-lo.
 *
 * A normalização remove acento e colapsa espaço porque o mesmo banco emite
 * "TARIFA MENSALIDADE" e "Tarifa  Mensalidade" no mesmo arquivo.
 */
export function readSignals(input: {
  description?: string | null;
  document?: string | null;
  counterpartName?: string | null;
  counterpartDocument?: string | null;
}): BankTransactionSignals {
  const text = normalize(
    [input.description, input.counterpartName, input.document].filter(Boolean).join(' '),
  );

  const kind = KIND_PATTERNS.find(([, pattern]) => pattern.test(text))?.[0] ?? 'OUTRO';

  const rawDocument = input.counterpartDocument ?? DOCUMENT_PATTERN.exec(text)?.[1];
  const document = rawDocument?.replace(/\D/g, '');

  // O documento também casa com `REFERENCE_PATTERN`; procurar a referência no
  // texto já sem ele evita devolver o CNPJ como se fosse nosso número.
  const withoutDocument = rawDocument ? text.replace(rawDocument, ' ') : text;
  const reference = input.document?.trim() || REFERENCE_PATTERN.exec(withoutDocument)?.[1];

  return {
    kind,
    document: document && (document.length === 11 || document.length === 14) ? document : undefined,
    reference: reference || undefined,
    counterpartName: input.counterpartName?.trim() || undefined,
  };
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

/**
 * Identificação dos movimentos bancários (RF-072).
 *
 * A identificação é gravada em `transacao_bancaria.metadados`, que é — junto
 * com `status_conciliacao` — o único par que o trigger de bd/13 §9 deixa a
 * conciliação alterar. O resto da linha é fato consumado do banco.
 *
 * É gravada, e não recalculada a cada leitura, porque o resultado depende do
 * cadastro no momento em que foi feito: um parceiro cadastrado depois muda a
 * identificação de amanhã, mas não deve mudar, retroativamente, a evidência do
 * que se sabia quando a conciliação foi decidida.
 */
@Injectable()
export class BankTransactionIdentifierService {
  constructor(private readonly prisma: PrismaService) {}

  async identify(companyId: string, bankTransactionId: string) {
    const movement = await this.prisma.db.bankTransaction.findFirst({
      where: { id: bankTransactionId, companyId },
      select: {
        id: true,
        bankAccountId: true,
        direction: true,
        description: true,
        document: true,
        counterpartName: true,
        counterpartDocument: true,
        metadata: true,
      },
    });
    if (!movement) {
      throw new NotFoundException('Movimento bancário não encontrado.');
    }

    const identification = await this.resolve(companyId, movement);

    const metadata =
      movement.metadata &&
      typeof movement.metadata === 'object' &&
      !Array.isArray(movement.metadata)
        ? (movement.metadata as Prisma.JsonObject)
        : {};

    await this.prisma.db.bankTransaction.update({
      where: { id: movement.id },
      data: {
        metadata: {
          ...metadata,
          identification: identification as unknown as Prisma.JsonObject,
        },
      },
      select: { id: true },
    });

    return { bankTransactionId: movement.id, ...identification };
  }

  /** Sinais do texto + confirmação no cadastro, sem gravar nada. */
  async resolve(
    companyId: string,
    movement: {
      bankAccountId: string;
      direction: TransactionDirection;
      description?: string | null;
      document?: string | null;
      counterpartName?: string | null;
      counterpartDocument?: string | null;
    },
  ): Promise<BankTransactionIdentification> {
    const signals = readSignals(movement);

    const partner = await this.findPartner(companyId, signals);
    const internalAccountId = await this.findInternalAccount(companyId, movement, signals);

    return {
      ...signals,
      partnerId: partner?.id,
      partnerName: partner?.tradeName ?? partner?.legalName,
      internalAccountId,
      identifiedAt: new Date().toISOString(),
    };
  }

  /**
   * Parceiro pelo documento; na falta dele, pelo nome exato da contraparte.
   *
   * Só igualdade — nunca `contains` sobre o nome do extrato. "PAPELARIA SILVA"
   * casando com "SILVA" produziria uma identificação errada que depois vira
   * sugestão de conciliação, e o custo de desfazer isso é maior que o de deixar
   * o movimento sem parceiro.
   */
  private async findPartner(companyId: string, signals: BankTransactionSignals) {
    if (signals.document) {
      const byDocument = await this.prisma.db.partner.findFirst({
        where: {
          companyId,
          isActive: true,
          ...(signals.document.length === 14
            ? { cnpj: signals.document }
            : { cpf: signals.document }),
        },
        select: { id: true, legalName: true, tradeName: true },
      });
      if (byDocument) {
        return byDocument;
      }
    }

    if (!signals.counterpartName || signals.counterpartName.length < 4) {
      return null;
    }

    return this.prisma.db.partner.findFirst({
      where: {
        companyId,
        isActive: true,
        OR: [
          { legalName: { equals: signals.counterpartName, mode: 'insensitive' } },
          { tradeName: { equals: signals.counterpartName, mode: 'insensitive' } },
        ],
      },
      select: { id: true, legalName: true, tradeName: true },
    });
  }

  /**
   * Transferência entre contas da própria empresa.
   *
   * Vale a consulta porque é o caso que mais polui a conciliação: o dinheiro
   * aparece duas vezes, saindo de uma conta e entrando em outra, e nenhuma das
   * duas linhas tem título — sem reconhecê-las, as duas ficam para sempre na
   * lista de pendências.
   */
  private async findInternalAccount(
    companyId: string,
    movement: { bankAccountId: string },
    signals: BankTransactionSignals,
  ): Promise<string | undefined> {
    // Só há como afirmar "é outra conta nossa" quando o extrato traz a chave —
    // a natureza sozinha não diz qual conta, e chutar uma delas seria pior que
    // deixar o movimento sem identificação.
    if (!signals.document) {
      return undefined;
    }

    const account = await this.prisma.db.companyBankAccount.findFirst({
      where: {
        companyId,
        id: { not: movement.bankAccountId },
        pixKey: signals.document,
      },
      select: { id: true },
    });

    return account?.id;
  }
}
