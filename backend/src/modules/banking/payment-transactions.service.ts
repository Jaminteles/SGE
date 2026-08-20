import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditEvent,
  EntryType,
  PaymentMethodType,
  PaymentTransactionStatus,
  Prisma,
  TransactionDirection,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AUDIT_ENTITY, AuditService } from '../../common/audit/audit.service';
import { PaginatedResult } from '../../common/dto/paginated-result';
import { toDateOnly } from '../../common/utils/date-only';
import { JobQueueService } from '../../common/queue/job-queue.service';
import { QUEUES } from '../../common/queue/job.types';
import {
  IDEMPOTENCY_SCOPE,
  IdempotencyService,
} from '../../common/idempotency/idempotency.service';
import { CompanyAccountsService } from './company-accounts.service';
import { PaymentSettlementsService } from './payment-settlements.service';
import { ProviderResolver } from './providers/provider-resolver.service';
import {
  PaymentOrder,
  ProviderCapabilities,
  ProviderError,
  ProviderResult,
} from './providers/payment-provider.port';
import { CreatePaymentDto, SUPPORTED_PAYMENT_METHODS } from './dto/create-payment.dto';
import { CancelPaymentDto, ConfirmPaymentDto } from './dto/payment-actions.dto';
import { QueryPaymentDto } from './dto/query-payment.dto';

/** Nomes dos jobs desta fila. */
export const PAYMENT_JOBS = {
  SEND: 'payment.send',
  SYNC: 'payment.sync',
} as const;

/** Situações em que a ordem ainda não saiu — dá para cancelar sem o provedor. */
const NOT_YET_SENT: PaymentTransactionStatus[] = [
  PaymentTransactionStatus.CRIADA,
  PaymentTransactionStatus.AGENDADA,
  PaymentTransactionStatus.ENFILEIRADA,
];

/** Situações terminais: nada mais acontece com a ordem. */
const TERMINAL: PaymentTransactionStatus[] = [
  PaymentTransactionStatus.CONFIRMADA,
  PaymentTransactionStatus.CANCELADA,
  PaymentTransactionStatus.ESTORNADA,
  PaymentTransactionStatus.EXPIRADA,
];

const DETAIL_FIELDS = {
  companyId: true,
  id: true,
  bankAccountId: true,
  providerId: true,
  installmentId: true,
  direction: true,
  method: true,
  status: true,
  amount: true,
  description: true,
  scheduledFor: true,
  executedAt: true,
  confirmedAt: true,
  payeeName: true,
  payeeDocument: true,
  payeeBankCode: true,
  payeeAgency: true,
  payeeAccount: true,
  pixKey: true,
  barcode: true,
  idempotencyKey: true,
  externalId: true,
  endToEndId: true,
  errorCode: true,
  errorMessage: true,
  attempts: true,
  maxAttempts: true,
  cancellable: true,
  cancelledAt: true,
  cancellationReason: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PaymentTransactionSelect;

/** Projeção usada pelo envio e pelo cancelamento: inclui a conta de origem. */
const LOAD_FIELDS = {
  ...DETAIL_FIELDS,
  bankAccount: {
    select: {
      id: true,
      bankCode: true,
      agency: true,
      account: true,
      accountDigit: true,
      pixKey: true,
      providerId: true,
      credentialId: true,
    },
  },
} satisfies Prisma.PaymentTransactionSelect;

export type LoadedTransaction = Prisma.PaymentTransactionGetPayload<{
  select: typeof LOAD_FIELDS;
}>;

/** Capacidade exigida por modalidade (RF-062). */
const METHOD_CAPABILITY: Record<string, keyof ProviderCapabilities> = {
  [PaymentMethodType.PIX]: 'pix',
  [PaymentMethodType.BOLETO]: 'boleto',
  [PaymentMethodType.TED]: 'ted',
  [PaymentMethodType.DOC]: 'doc',
  [PaymentMethodType.TRANSFERENCIA_INTERNA]: 'transferencia_interna',
};

/**
 * Ordens de pagamento e recebimento (RF-062 a RF-065, RF-067 a RF-070).
 *
 * O desenho todo gira em torno de uma frase: **o dinheiro sai uma vez só**.
 *
 *  - criar é idempotente pela `Idempotency-Key` do cliente (RF-067). O retry do
 *    front, do gateway ou do celular do usuário devolve a mesma ordem;
 *  - enviar é assíncrono (RF-069) e o worker só escreve depois de o provedor
 *    responder. Falha de rede não deixa a ordem em estado intermediário — ela
 *    continua enfileirada e é retentada com backoff (RF-070);
 *  - a confirmação, venha de webhook, de consulta ou de operador, passa por
 *    `applyResult`, e é lá que a baixa do título é gerada — uma vez, garantido
 *    por índice único (RN-004).
 *
 * O que este serviço **não** faz: falar HTTP. Isso é do adaptador (RF-061). E
 * não recalcula saldo de conta: `saldo_atual` é o que o banco disse no extrato.
 */
@Injectable()
export class PaymentTransactionsService {
  private readonly logger = new Logger(PaymentTransactionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: CompanyAccountsService,
    private readonly providers: ProviderResolver,
    private readonly settlements: PaymentSettlementsService,
    private readonly idempotency: IdempotencyService,
    private readonly queue: JobQueueService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Criação (RF-062, RF-063, RF-067, RF-069)
  // ---------------------------------------------------------------------------

  async create(companyId: string, dto: CreatePaymentDto, userId: string, idempotencyKey: string) {
    const run = await this.idempotency.run({
      companyId,
      scope: IDEMPOTENCY_SCOPE.PAYMENT,
      key: idempotencyKey,
      request: dto,
      userId,
      execute: async () => {
        const created = await this.persist(companyId, dto, userId, idempotencyKey);
        return { resourceId: created.id, resourceType: 'transacao_pagamento', response: created };
      },
    });

    return run.response;
  }

  private async persist(
    companyId: string,
    dto: CreatePaymentDto,
    userId: string,
    idempotencyKey: string,
  ) {
    const direction = dto.direction ?? TransactionDirection.DEBITO;
    const amount = new Prisma.Decimal(dto.amount);
    if (amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('O valor da ordem deve ser maior que zero.');
    }
    if (
      !SUPPORTED_PAYMENT_METHODS.includes(dto.method as (typeof SUPPORTED_PAYMENT_METHODS)[number])
    ) {
      throw new BadRequestException(
        `A modalidade ${dto.method} não é executada por integração bancária.`,
      );
    }

    const account = await this.accounts.findForPayment(companyId, dto.bankAccountId);
    if (direction === TransactionDirection.DEBITO && !account.allowsPayment) {
      throw new BadRequestException('A conta informada não está habilitada para pagamento.');
    }
    if (direction === TransactionDirection.CREDITO && !account.allowsReceipt) {
      throw new BadRequestException('A conta informada não está habilitada para recebimento.');
    }

    const resolved = await this.providers.resolveForAccount(companyId, account);
    this.assertMethodSupported(
      dto.method,
      resolved.context.capabilities,
      resolved.context.providerCode,
    );
    this.assertPayee(dto);

    if (dto.installmentId) {
      await this.assertInstallment(companyId, dto.installmentId, direction, amount);
    }

    const scheduledFor = dto.scheduledFor ? toDateOnly(dto.scheduledFor) : undefined;
    if (scheduledFor && scheduledFor.getTime() < startOfToday()) {
      throw new BadRequestException('A data de agendamento não pode estar no passado.');
    }

    return this.prisma.transaction(async () => {
      const transaction = await this.prisma.db.paymentTransaction.create({
        data: {
          companyId,
          bankAccountId: account.id,
          providerId: resolved.providerId,
          installmentId: dto.installmentId,
          direction,
          method: dto.method,
          status: scheduledFor
            ? PaymentTransactionStatus.AGENDADA
            : PaymentTransactionStatus.CRIADA,
          amount,
          description: dto.description,
          scheduledFor,
          payeeName: dto.payeeName,
          payeeDocument: dto.payeeDocument,
          payeeBankCode: dto.payeeBankCode,
          payeeAgency: dto.payeeAgency,
          payeeAccount: dto.payeeAccount,
          pixKey: dto.pixKey,
          barcode: dto.barcode,
          idempotencyKey,
          // RF-065: o que o provedor não cancela, o banco não deixa cancelar.
          cancellable: resolved.context.capabilities.cancelamento === true,
          requestedById: userId,
        },
        select: DETAIL_FIELDS,
      });

      // Enfileirar e marcar como enfileirada acontecem na mesma transação da
      // criação: não existe ordem gravada sem job, nem job sem ordem.
      await this.queue.enqueue({
        queue: QUEUES.PAYMENTS,
        name: PAYMENT_JOBS.SEND,
        companyId,
        payload: { transactionId: transaction.id },
        scheduledFor,
        idempotencyKey: `send:${transaction.id}`,
      });

      const queued = scheduledFor
        ? transaction
        : await this.prisma.db.paymentTransaction.update({
            where: { id: transaction.id },
            data: { status: PaymentTransactionStatus.ENFILEIRADA },
            select: DETAIL_FIELDS,
          });

      await this.audit.record({
        event: AuditEvent.CRIACAO,
        entity: AUDIT_ENTITY.PAYMENT_TRANSACTION,
        entityId: transaction.id,
        note:
          `Ordem ${dto.method} de ${amount.toFixed(2)} na conta ${account.bankCode}/${account.agency}/${account.account}` +
          (scheduledFor ? ` agendada para ${dto.scheduledFor}.` : '.'),
      });

      return queued;
    });
  }

  // ---------------------------------------------------------------------------
  // Consulta (RF-064)
  // ---------------------------------------------------------------------------

  async findAll(companyId: string, query: QueryPaymentDto) {
    const where: Prisma.PaymentTransactionWhereInput = {
      companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.direction ? { direction: query.direction } : {}),
      ...(query.method ? { method: query.method } : {}),
      ...(query.bankAccountId ? { bankAccountId: query.bankAccountId } : {}),
      ...(query.installmentId ? { installmentId: query.installmentId } : {}),
      ...(query.createdFrom || query.createdTo
        ? {
            createdAt: {
              ...(query.createdFrom ? { gte: toDateOnly(query.createdFrom) } : {}),
              ...(query.createdTo ? { lt: nextDay(toDateOnly(query.createdTo)) } : {}),
            },
          }
        : {}),
      ...(query.q
        ? {
            OR: [
              { payeeName: { contains: query.q, mode: 'insensitive' } },
              { description: { contains: query.q, mode: 'insensitive' } },
              { externalId: { contains: query.q } },
            ],
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.db.paymentTransaction.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip: query.skip,
        take: query.take,
        select: DETAIL_FIELDS,
      }),
      this.prisma.db.paymentTransaction.count({ where }),
    ]);

    return new PaginatedResult(data, total, query.page, query.pageSize);
  }

  async findOne(companyId: string, id: string) {
    const transaction = await this.prisma.db.paymentTransaction.findFirst({
      where: { id, companyId },
      select: {
        ...DETAIL_FIELDS,
        bankAccount: { select: { id: true, description: true, bankCode: true, account: true } },
        settlements: { select: { id: true, settlementDate: true, totalAmount: true } },
      },
    });
    if (!transaction) {
      throw new NotFoundException('Ordem de pagamento não encontrada.');
    }
    return transaction;
  }

  /**
   * Pergunta a situação ao provedor e aplica o que ele responder (RF-064).
   *
   * Existe para o caso em que o webhook não chegou. Não força nada: se a
   * resposta trouxer o mesmo estado, nada muda.
   */
  async sync(companyId: string, id: string) {
    const transaction = await this.load(companyId, id);

    if (!transaction.externalId) {
      throw new ConflictException('A ordem ainda não tem identificador no provedor.');
    }
    if (TERMINAL.includes(transaction.status)) {
      return this.findOne(companyId, id);
    }

    const resolved = await this.providers.resolveForAccount(companyId, {
      id: transaction.bankAccountId,
      providerId: transaction.bankAccount.providerId,
      credentialId: transaction.bankAccount.credentialId,
    });
    if (!resolved.context.capabilities.consulta) {
      throw new ConflictException(
        `O provedor ${resolved.context.providerCode} não suporta consulta de situação.`,
      );
    }

    const result = await resolved.provider.query(transaction.externalId, resolved.context);
    await this.applyResult(transaction, result);
    return this.findOne(companyId, id);
  }

  // ---------------------------------------------------------------------------
  // Cancelamento (RF-065)
  // ---------------------------------------------------------------------------

  async cancel(companyId: string, id: string, dto: CancelPaymentDto, userId: string) {
    const transaction = await this.load(companyId, id);

    if (TERMINAL.includes(transaction.status)) {
      throw new ConflictException(
        `A ordem está ${transaction.status} e não pode mais ser cancelada.`,
      );
    }

    // Ordem que ainda não saiu se cancela aqui mesmo: não há o que desfazer no
    // banco, e exigir suporte do provedor impediria desistir de um agendamento.
    if (!NOT_YET_SENT.includes(transaction.status)) {
      if (!transaction.cancellable) {
        throw new ConflictException(
          'O provedor desta ordem não suporta cancelamento depois do envio.',
        );
      }
      const resolved = await this.providers.resolveForAccount(companyId, {
        id: transaction.bankAccountId,
        providerId: transaction.bankAccount.providerId,
        credentialId: transaction.bankAccount.credentialId,
      });
      if (!transaction.externalId) {
        throw new ConflictException('A ordem ainda não tem identificador no provedor.');
      }
      // Se o provedor recusar, a exceção sobe e a ordem continua como estava —
      // o pior desfecho seria marcá-la cancelada aqui e paga lá.
      await resolved.provider.cancel(transaction.externalId, dto.reason, resolved.context);
    }

    await this.prisma.db.paymentTransaction.update({
      where: { id },
      data: {
        status: PaymentTransactionStatus.CANCELADA,
        cancellationReason: dto.reason,
        cancelledAt: new Date(),
      },
    });

    await this.audit.record({
      event: AuditEvent.CANCELAMENTO,
      entity: AUDIT_ENTITY.PAYMENT_TRANSACTION,
      entityId: id,
      userId,
      note: `Ordem de ${transaction.amount.toFixed(2)} cancelada: ${dto.reason}`,
    });

    return this.findOne(companyId, id);
  }

  // ---------------------------------------------------------------------------
  // Confirmação manual (RF-064)
  // ---------------------------------------------------------------------------

  async confirmManually(companyId: string, id: string, dto: ConfirmPaymentDto, userId: string) {
    const transaction = await this.load(companyId, id);

    if (transaction.status === PaymentTransactionStatus.CONFIRMADA) {
      // Repetir a confirmação não gera segunda baixa: a resposta é a mesma.
      return this.findOne(companyId, id);
    }
    if (TERMINAL.includes(transaction.status)) {
      throw new ConflictException(`A ordem está ${transaction.status} e não pode ser confirmada.`);
    }

    await this.applyResult(
      transaction,
      {
        status: 'CONFIRMADA',
        externalId: dto.externalId,
      },
      dto.confirmedAt ? new Date(dto.confirmedAt) : undefined,
    );

    await this.audit.record({
      event: AuditEvent.PAGAMENTO,
      entity: AUDIT_ENTITY.PAYMENT_TRANSACTION,
      entityId: id,
      userId,
      note: `Confirmação manual de ${transaction.amount.toFixed(2)}${dto.note ? `: ${dto.note}` : '.'}`,
    });

    return this.findOne(companyId, id);
  }

  // ---------------------------------------------------------------------------
  // Execução pelo worker (RF-069/RF-070)
  // ---------------------------------------------------------------------------

  /**
   * Envia a ordem ao provedor.
   *
   * Nada é gravado antes da resposta: uma falha de rede não deve deixar a ordem
   * num estado que ninguém sabe interpretar. Erro retentável sobe para a fila
   * (que reagenda com backoff); erro definitivo vira FALHA aqui mesmo, e o job
   * termina — insistir não mudaria a resposta.
   */
  async dispatch(companyId: string, transactionId: string): Promise<void> {
    const transaction = await this.load(companyId, transactionId);

    // Reentrância: o job pode ser reexecutado depois de a ordem já ter saído
    // (retry após timeout na gravação). Nesse caso não há nada a fazer.
    if (!NOT_YET_SENT.includes(transaction.status)) {
      this.logger.debug(`Ordem ${transactionId} já está ${transaction.status}; envio ignorado.`);
      return;
    }

    const resolved = await this.providers.resolveForAccount(companyId, {
      id: transaction.bankAccountId,
      providerId: transaction.bankAccount.providerId,
      credentialId: transaction.bankAccount.credentialId,
    });

    const order: PaymentOrder = {
      transactionId: transaction.id,
      idempotencyKey: transaction.idempotencyKey,
      direction: transaction.direction,
      method: transaction.method,
      amount: transaction.amount.toFixed(2),
      description: transaction.description,
      scheduledFor: transaction.scheduledFor
        ? transaction.scheduledFor.toISOString().slice(0, 10)
        : null,
      account: {
        id: transaction.bankAccount.id,
        bankCode: transaction.bankAccount.bankCode,
        agency: transaction.bankAccount.agency,
        account: transaction.bankAccount.account,
        accountDigit: transaction.bankAccount.accountDigit,
        pixKey: transaction.bankAccount.pixKey,
      },
      payee: {
        name: transaction.payeeName,
        document: transaction.payeeDocument,
        bankCode: transaction.payeeBankCode,
        agency: transaction.payeeAgency,
        account: transaction.payeeAccount,
        pixKey: transaction.pixKey,
        barcode: transaction.barcode,
      },
    };

    let result: ProviderResult;
    try {
      result = await resolved.provider.send(order, resolved.context);
    } catch (error) {
      if (error instanceof ProviderError && !error.retryable) {
        await this.markFailed(transaction, error.code, error.message);
        return;
      }
      throw error;
    }

    await this.applyResult(transaction, result);
  }

  // ---------------------------------------------------------------------------
  // Aplicação de resultado — a porta única por onde o estado muda
  // ---------------------------------------------------------------------------

  /**
   * Traduz a resposta do provedor em estado, e gera a baixa quando confirma.
   *
   * Ponto único de mudança de propósito: webhook (RF-066), consulta (RF-064),
   * envio (RF-069) e confirmação manual passam todos por aqui, e por isso a
   * regra de "confirmar gera baixa, uma vez" está escrita num lugar só.
   */
  async applyResult(
    transaction: LoadedTransaction,
    result: ProviderResult,
    confirmedAt?: Date,
  ): Promise<void> {
    const status = STATUS_BY_PROVIDER[result.status];

    if (transaction.status === status && !result.externalId) {
      return;
    }

    const updated = await this.prisma.db.paymentTransaction.update({
      where: { id: transaction.id },
      data: {
        status,
        // O identificador externo só é gravado uma vez (bd/13 §5): reenviar o
        // mesmo valor é inofensivo, trocar por outro é recusado pelo banco.
        ...(result.externalId && !transaction.externalId ? { externalId: result.externalId } : {}),
        ...(result.endToEndId ? { endToEndId: result.endToEndId } : {}),
        ...(confirmedAt ? { confirmedAt } : {}),
        ...(status === PaymentTransactionStatus.FALHA
          ? {
              errorCode: result.errorCode ?? 'FALHA_PROVEDOR',
              errorMessage: result.errorMessage ?? 'O provedor recusou a operação.',
            }
          : {}),
        // Sem credenciais: o adaptador devolve só o corpo da resposta.
        ...(result.raw ? { responsePayload: result.raw as Prisma.InputJsonValue } : {}),
      },
      select: {
        id: true,
        companyId: true,
        bankAccountId: true,
        installmentId: true,
        amount: true,
        method: true,
        description: true,
        confirmedAt: true,
        status: true,
      },
    });

    if (updated.status === PaymentTransactionStatus.CONFIRMADA) {
      await this.settlements.settle(updated);
    }
  }

  /** Carrega a ordem com o que o envio e o cancelamento precisam. */
  async load(companyId: string, id: string): Promise<LoadedTransaction> {
    const transaction = await this.prisma.db.paymentTransaction.findFirst({
      where: { id, companyId },
      select: LOAD_FIELDS,
    });
    if (!transaction) {
      throw new NotFoundException('Ordem de pagamento não encontrada.');
    }
    return transaction;
  }

  private async markFailed(
    transaction: LoadedTransaction,
    code: string,
    message: string,
  ): Promise<void> {
    await this.prisma.db.paymentTransaction.update({
      where: { id: transaction.id },
      data: {
        status: PaymentTransactionStatus.FALHA,
        errorCode: code.slice(0, 60),
        errorMessage: message.slice(0, 2000),
        attempts: { increment: 1 },
      },
    });
    this.logger.warn(`Ordem ${transaction.id} recusada pelo provedor (${code}): ${message}`);
  }

  private assertMethodSupported(
    method: PaymentMethodType,
    capabilities: ProviderCapabilities,
    providerCode: string,
  ): void {
    const capability = METHOD_CAPABILITY[method];
    if (capability && capabilities[capability] !== true) {
      throw new BadRequestException(
        `O provedor ${providerCode} não executa pagamentos por ${method}.`,
      );
    }
  }

  /** Cada modalidade tem o destino sem o qual ela não existe (RF-062). */
  private assertPayee(dto: CreatePaymentDto): void {
    switch (dto.method) {
      case PaymentMethodType.PIX:
        if (!dto.pixKey) {
          throw new BadRequestException('Pagamento PIX exige a chave do favorecido.');
        }
        break;
      case PaymentMethodType.BOLETO:
        if (!dto.barcode) {
          throw new BadRequestException('Pagamento por boleto exige o código de barras.');
        }
        break;
      case PaymentMethodType.TED:
      case PaymentMethodType.DOC:
        if (!dto.payeeBankCode || !dto.payeeAgency || !dto.payeeAccount || !dto.payeeDocument) {
          throw new BadRequestException(
            'Transferência exige banco, agência, conta e CPF/CNPJ do favorecido.',
          );
        }
        break;
      case PaymentMethodType.TRANSFERENCIA_INTERNA:
        if (!dto.payeeAccount) {
          throw new BadRequestException('Transferência interna exige a conta do favorecido.');
        }
        break;
      default:
        break;
    }
  }

  /**
   * A parcela precisa existir na empresa, estar em aberto e pertencer à carteira
   * compatível com o sentido: pagar quita título a pagar, receber quita título a
   * receber. Pagar um título a receber seria devolver dinheiro achando que se
   * está recebendo.
   */
  private async assertInstallment(
    companyId: string,
    installmentId: string,
    direction: TransactionDirection,
    amount: Prisma.Decimal,
  ): Promise<void> {
    const installment = await this.prisma.db.financialInstallment.findFirst({
      where: { id: installmentId, companyId },
      select: { status: true, balance: true, entry: { select: { type: true } } },
    });
    if (!installment) {
      throw new BadRequestException('Parcela inválida para esta empresa.');
    }

    const expected =
      installment.entry.type === EntryType.PAGAR
        ? TransactionDirection.DEBITO
        : TransactionDirection.CREDITO;
    if (direction !== expected) {
      throw new BadRequestException(
        `A parcela é de um título a ${installment.entry.type.toLowerCase()} e exige uma ordem de ${expected.toLowerCase()}.`,
      );
    }
    if (installment.balance.lessThanOrEqualTo(0)) {
      throw new ConflictException('A parcela informada não tem saldo em aberto.');
    }
    if (amount.greaterThan(installment.balance.times(2))) {
      // Encargo é normal; o dobro do saldo é erro de digitação.
      throw new BadRequestException(
        `O valor da ordem excede em muito o saldo de ${installment.balance.toFixed(2)} da parcela.`,
      );
    }

    // Uma ordem viva por parcela: duas em paralelo pagariam a mesma dívida duas
    // vezes, e o índice único da baixa só barraria a segunda depois de o
    // dinheiro já ter saído.
    const inFlight = await this.prisma.db.paymentTransaction.findFirst({
      where: {
        companyId,
        installmentId,
        status: { notIn: [...TERMINAL, PaymentTransactionStatus.FALHA] },
      },
      select: { id: true },
    });
    if (inFlight) {
      throw new ConflictException(
        `Já existe uma ordem em andamento para esta parcela (${inFlight.id}).`,
      );
    }
  }
}

/** Vocabulário do adaptador -> situação da transação. */
const STATUS_BY_PROVIDER: Record<ProviderResult['status'], PaymentTransactionStatus> = {
  ENVIADA: PaymentTransactionStatus.ENVIADA,
  PROCESSANDO: PaymentTransactionStatus.PROCESSANDO,
  CONFIRMADA: PaymentTransactionStatus.CONFIRMADA,
  FALHA: PaymentTransactionStatus.FALHA,
  CANCELADA: PaymentTransactionStatus.CANCELADA,
};

/** Meia-noite local de hoje, em milissegundos — piso do agendamento. */
function startOfToday(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function nextDay(date: Date): Date {
  return new Date(date.getTime() + 24 * 60 * 60 * 1000);
}
