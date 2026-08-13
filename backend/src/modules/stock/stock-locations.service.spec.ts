import { BadRequestException, NotFoundException } from '@nestjs/common';
import { StockLocationsService } from './stock-locations.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ReferencesService } from '../../common/references/references.service';

const LOCATION = {
  id: 'loc-1',
  companyId: 'empresa-1',
  branchId: 'fil-1',
  code: 'DEP-01',
  name: 'Depósito central',
  isDefault: false,
  isActive: true,
};

function buildService(
  location: Record<string, unknown> | null = LOCATION,
  balance: { id: string } | null = null,
) {
  const locationDelegate = {
    create: jest.fn().mockResolvedValue({ id: 'loc-1' }),
    findFirst: jest.fn().mockResolvedValue(location),
    findMany: jest.fn().mockResolvedValue([LOCATION]),
    count: jest.fn().mockResolvedValue(1),
    update: jest.fn().mockResolvedValue(LOCATION),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  };

  const prisma = {
    db: {
      stockLocation: locationDelegate,
      stockBalance: { findFirst: jest.fn().mockResolvedValue(balance) },
    },
    transaction: jest.fn().mockImplementation((fn: () => unknown) => fn()),
  } as unknown as PrismaService;

  const references = {
    assert: jest.fn().mockResolvedValue(undefined),
  } as unknown as ReferencesService;

  return { service: new StockLocationsService(prisma, references), locationDelegate, references };
}

describe('StockLocationsService', () => {
  it('valida a filial dentro da empresa', async () => {
    const { service, references } = buildService();

    await service.create('empresa-1', { branchId: 'fil-1', code: 'DEP-01', name: 'Depósito' });

    expect(references.assert).toHaveBeenCalledWith('empresa-1', { branchId: 'fil-1' });
  });

  // Dois padrões na mesma filial deixariam a escolha do destino para o
  // `ORDER BY` de quem consulta — o índice único de bd/08 recusaria o segundo.
  it('desmarca o padrão anterior da filial ao definir um novo', async () => {
    const { service, locationDelegate } = buildService();

    await service.create('empresa-1', {
      branchId: 'fil-1',
      code: 'DEP-02',
      name: 'Depósito 2',
      isDefault: true,
    });

    expect(locationDelegate.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: 'empresa-1',
          branchId: 'fil-1',
          isDefault: true,
        }),
        data: { isDefault: false },
      }),
    );
  });

  // Inativar com saldo esconderia estoque que existe: some do alerta de mínimo
  // e da valorização sem nunca ter saído.
  it('recusa inativar local com saldo', async () => {
    const { service } = buildService(LOCATION, { id: 'saldo-1' });

    await expect(service.remove('empresa-1', 'loc-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('inativa em vez de remover', async () => {
    const { service, locationDelegate } = buildService();

    await service.remove('empresa-1', 'loc-1');

    expect(locationDelegate.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isActive: false } }),
    );
  });

  // RN-001: o recorte por empresa é do servidor.
  it('não encontra local de outra empresa', async () => {
    const { service } = buildService(null);

    await expect(service.findOne('empresa-2', 'loc-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('filtra pela empresa ativa na listagem', async () => {
    const { service, locationDelegate } = buildService();

    await service.findAll('empresa-1', {
      page: 1,
      pageSize: 20,
      skip: 0,
      take: 20,
    } as never);

    expect(locationDelegate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: 'empresa-1' }) }),
    );
  });
});
