import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ItemType, Prisma } from '@prisma/client';
import { ProductsService } from './products.service';
import { ReferencesService } from '../../common/references/references.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';

const PRODUCT = {
  id: 'prod-1',
  companyId: 'empresa-1',
  type: ItemType.PRODUTO,
  code: 'SKU-001',
  description: 'Papel A4 75g',
  tracksStock: true,
  minStock: new Prisma.Decimal(0),
  maxStock: null,
  serviceCodeLc116: null,
  isActive: true,
};

function buildService(product: Record<string, unknown> | null = PRODUCT) {
  const productDelegate = {
    create: jest.fn().mockResolvedValue(PRODUCT),
    findFirst: jest.fn().mockResolvedValue(product),
    findMany: jest.fn().mockResolvedValue([PRODUCT]),
    count: jest.fn().mockResolvedValue(1),
    update: jest.fn().mockResolvedValue(PRODUCT),
  };

  const prisma = { db: { product: productDelegate } } as unknown as PrismaService;
  const references = {
    assert: jest.fn().mockResolvedValue(undefined),
  } as unknown as ReferencesService;

  return { service: new ProductsService(prisma, references), productDelegate, references };
}

function createDto(overrides: Partial<CreateProductDto> = {}): CreateProductDto {
  return {
    code: 'SKU-001',
    description: 'Papel A4 75g',
    ...overrides,
  } as CreateProductDto;
}

describe('ProductsService', () => {
  // RF-028: serviço não tem estoque — o banco recusa a combinação (bd/01), e
  // aqui a recusa vira 400 em vez de 500.
  it('recusa serviço com controle de estoque', async () => {
    const { service } = buildService();

    await expect(
      service.create(
        'empresa-1',
        createDto({ type: ItemType.SERVICO, tracksStock: true, serviceCodeLc116: '14.01' }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('desliga o controle de estoque ao cadastrar serviço', async () => {
    const { service, productDelegate } = buildService();

    await service.create(
      'empresa-1',
      createDto({ type: ItemType.SERVICO, serviceCodeLc116: '14.01' }),
    );

    expect(productDelegate.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tracksStock: false }) }),
    );
  });

  // RF-030: sem o código da LC 116 o serviço não é classificável na NFS-e.
  it('exige o código de serviço da LC 116 em serviço', async () => {
    const { service } = buildService();

    await expect(
      service.create('empresa-1', createDto({ type: ItemType.SERVICO })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recusa estoque máximo menor que o mínimo', async () => {
    const { service } = buildService();

    await expect(
      service.create('empresa-1', createDto({ minStock: '10', maxStock: '5' })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('valida categoria e unidade dentro da empresa', async () => {
    const { service, references } = buildService();

    await service.create('empresa-1', createDto({ categoryId: 'cat-1', unitId: 'un-1' }));

    expect(references.assert).toHaveBeenCalledWith('empresa-1', {
      productCategoryId: 'cat-1',
      unitId: 'un-1',
    });
  });

  // RN-001: o recorte por empresa é do servidor.
  it('filtra pela empresa ativa na listagem', async () => {
    const { service, productDelegate } = buildService();

    await service.findAll('empresa-1', { page: 1, pageSize: 20, skip: 0, take: 20 } as never);

    expect(productDelegate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: 'empresa-1' }) }),
    );
  });

  it('não encontra item de outra empresa', async () => {
    const { service } = buildService(null);

    await expect(service.findOne('empresa-2', 'prod-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  // RN-009: item com movimento de estoque ou nota não é apagado.
  it('inativa em vez de remover', async () => {
    const { service, productDelegate } = buildService();

    await service.remove('empresa-1', 'prod-1');

    expect(productDelegate.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isActive: false } }),
    );
  });
});
