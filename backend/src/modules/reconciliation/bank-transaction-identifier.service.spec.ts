import { TransactionDirection } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  BankTransactionIdentifierService,
  readSignals,
} from './bank-transaction-identifier.service';

describe('readSignals', () => {
  it('reconhece a natureza pelo histórico, sem depender de acento ou caixa', () => {
    expect(readSignals({ description: 'Tarifa manutenção de conta' }).kind).toBe('TARIFA');
    expect(readSignals({ description: 'PIX RECEBIDO' }).kind).toBe('PIX');
    expect(readSignals({ description: 'TED ENVIADA' }).kind).toBe('TED');
    expect(readSignals({ description: 'LIQUIDACAO DE TITULO' }).kind).toBe('BOLETO');
    expect(readSignals({ description: 'DARF PAGAMENTO' }).kind).toBe('IMPOSTO');
    expect(readSignals({ description: 'DEPOSITO EM DINHEIRO' }).kind).toBe('OUTRO');
  });

  it('prefere estorno a qualquer outra natureza que também apareça', () => {
    expect(readSignals({ description: 'ESTORNO DE PIX RECEBIDO' }).kind).toBe('ESTORNO');
  });

  it('extrai CNPJ e CPF do histórico, com ou sem máscara', () => {
    expect(readSignals({ description: 'PIX 12.345.678/0001-90 ACME' }).document).toBe(
      '12345678000190',
    );
    expect(readSignals({ description: 'TED 123.456.789-09' }).document).toBe('12345678909');
  });

  it('não confunde o documento da contraparte com a referência do título', () => {
    const signals = readSignals({
      description: 'BOLETO 12.345.678/0001-90 NOSSO NUMERO 98765432100',
    });

    expect(signals.document).toBe('12345678000190');
    expect(signals.reference).toBe('98765432100');
  });

  it('ignora sequência de dígitos que não é CPF nem CNPJ', () => {
    expect(readSignals({ description: 'PIX 1234567' }).document).toBeUndefined();
  });

  it('usa o campo de contraparte do extrato quando ele vem preenchido', () => {
    const signals = readSignals({
      description: 'PIX RECEBIDO',
      counterpartDocument: '12345678000190',
      counterpartName: 'ACME LTDA',
    });

    expect(signals.document).toBe('12345678000190');
    expect(signals.counterpartName).toBe('ACME LTDA');
  });
});

describe('BankTransactionIdentifierService.resolve', () => {
  function buildService(partner: Record<string, unknown> | null) {
    const prisma = {
      db: {
        partner: { findFirst: jest.fn().mockResolvedValue(partner) },
        companyBankAccount: { findFirst: jest.fn().mockResolvedValue(null) },
      },
    } as unknown as PrismaService;

    return { service: new BankTransactionIdentifierService(prisma), prisma };
  }

  const movement = {
    bankAccountId: 'conta-1',
    direction: TransactionDirection.CREDITO,
    description: 'PIX 12.345.678/0001-90',
    document: null,
    counterpartName: 'ACME LTDA',
    counterpartDocument: null,
  };

  it('resolve o parceiro pelo CNPJ, dentro da empresa ativa', async () => {
    const { service, prisma } = buildService({
      id: 'parceiro-1',
      legalName: 'ACME LTDA',
      tradeName: 'ACME',
    });

    const identification = await service.resolve('empresa-1', movement);

    expect(identification.partnerId).toBe('parceiro-1');
    expect(identification.partnerName).toBe('ACME');
    expect(prisma.db.partner.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: 'empresa-1', cnpj: '12345678000190' }),
      }),
    );
  });

  it('não inventa parceiro quando o cadastro não confirma', async () => {
    const { service } = buildService(null);

    const identification = await service.resolve('empresa-1', movement);

    expect(identification.partnerId).toBeUndefined();
    expect(identification.kind).toBe('PIX');
  });

  it('não procura parceiro por nome curto demais para ser único', async () => {
    const { service, prisma } = buildService(null);

    await service.resolve('empresa-1', {
      bankAccountId: 'conta-1',
      direction: TransactionDirection.CREDITO,
      description: 'DEPOSITO',
      counterpartName: 'ABC',
    });

    expect(prisma.db.partner.findFirst).not.toHaveBeenCalled();
  });
});
