import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { OcrSuggestionsService } from './ocr-suggestions.service';

interface Entry {
  categoryId: string | null;
  costCenterId: string | null;
}

function buildService(partner: { id: string; legalName: string } | null, history: Entry[] = []) {
  const findMany = jest.fn().mockResolvedValue(history);
  const findFirst = jest.fn().mockResolvedValue(partner);

  const prisma = {
    db: {
      partner: { findFirst },
      financialEntry: { findMany },
    },
  } as unknown as PrismaService;

  return { service: new OcrSuggestionsService(prisma), findFirst, findMany };
}

const CNPJ = '11222333000181';

describe('OcrSuggestionsService.suggest', () => {
  it('sugere a categoria e o centro de custo mais usados com aquele parceiro (RF-098)', async () => {
    const { service } = buildService({ id: 'parceiro-1', legalName: 'Posto Central' }, [
      { categoryId: 'combustivel', costCenterId: 'frota' },
      { categoryId: 'combustivel', costCenterId: 'frota' },
      { categoryId: 'manutencao', costCenterId: null },
    ]);

    const result = await service.suggest('empresa-1', {
      merchantDocument: CNPJ,
      amount: new Prisma.Decimal('120.00'),
    });

    expect(result).toMatchObject({
      partnerId: 'parceiro-1',
      categoryId: 'combustivel',
      costCenterId: 'frota',
    });
    expect(result.reasons).toHaveLength(3);
  });

  it('procura o parceiro dentro da empresa ativa, nunca por documento solto', async () => {
    const { service, findFirst } = buildService(null);

    await service.suggest('empresa-1', { merchantDocument: CNPJ });

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: 'empresa-1', cnpj: CNPJ }),
      }),
    );
  });

  it('busca por CPF quando o documento lido tem 11 dígitos', async () => {
    const { service, findFirst } = buildService(null);

    await service.suggest('empresa-1', { merchantDocument: '52998224725' });

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ cpf: '52998224725' }),
      }),
    );
  });

  it('não sugere nada sem documento legível: sugestão sem fundamento é aceita no automático', async () => {
    const { service, findFirst, findMany } = buildService(null);

    const result = await service.suggest('empresa-1', { merchantName: 'MERCADO X' });

    expect(result).toEqual({ reasons: [] });
    expect(findFirst).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('identifica o parceiro mesmo sem histórico, e aí não propõe classificação', async () => {
    const { service } = buildService({ id: 'parceiro-1', legalName: 'Nova Loja' }, []);

    const result = await service.suggest('empresa-1', { merchantDocument: CNPJ });

    expect(result.partnerId).toBe('parceiro-1');
    expect(result.categoryId).toBeUndefined();
    expect(result.costCenterId).toBeUndefined();
  });

  it('no empate fica com a classificação mais recente', async () => {
    const { service } = buildService({ id: 'parceiro-1', legalName: 'Fornecedor' }, [
      { categoryId: 'nova', costCenterId: null },
      { categoryId: 'antiga', costCenterId: null },
    ]);

    const result = await service.suggest('empresa-1', { merchantDocument: CNPJ });

    expect(result.categoryId).toBe('nova');
  });
});
