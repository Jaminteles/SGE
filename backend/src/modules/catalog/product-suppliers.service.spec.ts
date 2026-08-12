import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ProductSuppliersService } from './product-suppliers.service';
import { ProductsService } from './products.service';
import { ReferencesService } from '../../common/references/references.service';
import { PrismaService } from '../../prisma/prisma.service';

const LINK = {
  id: 'vinc-1',
  companyId: 'empresa-1',
  productId: 'prod-1',
  partnerId: 'parc-1',
  isPreferred: false,
};

function buildService(
  options: { existing?: unknown; link?: unknown; supplierValid?: boolean } = {},
) {
  const { existing = null, link = LINK, supplierValid = true } = options;

  const linkDelegate = {
    create: jest.fn().mockResolvedValue(LINK),
    findFirst: jest.fn().mockImplementation(({ select }: { select?: unknown }) =>
      // A checagem de duplicidade usa `select`; o carregamento do vínculo, não.
      Promise.resolve(select ? existing : link),
    ),
    findMany: jest.fn().mockResolvedValue([LINK]),
    update: jest.fn().mockResolvedValue(LINK),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    delete: jest.fn().mockResolvedValue(LINK),
  };

  const prisma = {
    db: { productSupplier: linkDelegate },
    transaction: <T>(fn: () => Promise<T>) => fn(),
  } as unknown as PrismaService;

  const products = {
    findOne: jest.fn().mockResolvedValue({ id: 'prod-1' }),
  } as unknown as ProductsService;

  const references = {
    assert: jest.fn().mockImplementation(() => {
      if (!supplierValid) {
        return Promise.reject(new BadRequestException('Fornecedor inválido para esta empresa.'));
      }
      return Promise.resolve(undefined);
    }),
  } as unknown as ReferencesService;

  return {
    service: new ProductSuppliersService(prisma, products, references),
    linkDelegate,
    references,
  };
}

describe('ProductSuppliersService', () => {
  // RF-027: o vínculo é com fornecedor. Um cliente aqui geraria pedido de
  // compra contra quem não vende.
  it('recusa parceiro sem papel de fornecedor', async () => {
    const { service } = buildService({ supplierValid: false });

    await expect(
      service.create('empresa-1', 'prod-1', { partnerId: 'parc-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('confere o papel de fornecedor pela empresa ativa', async () => {
    const { service, references } = buildService();

    await service.create('empresa-1', 'prod-1', { partnerId: 'parc-1' });

    expect(references.assert).toHaveBeenCalledWith('empresa-1', { supplierId: 'parc-1' });
  });

  it('recusa vincular o mesmo fornecedor duas vezes', async () => {
    const { service } = buildService({ existing: { id: 'vinc-1' } });

    await expect(
      service.create('empresa-1', 'prod-1', { partnerId: 'parc-1' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  // Dois preferenciais deixam a escolha da cotação para a ordenação.
  it('mantém um único fornecedor preferencial por item', async () => {
    const { service, linkDelegate } = buildService();

    await service.create('empresa-1', 'prod-1', { partnerId: 'parc-1', isPreferred: true });

    expect(linkDelegate.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ productId: 'prod-1', isPreferred: true }),
        data: { isPreferred: false },
      }),
    );
  });

  it('não encontra vínculo de outro item', async () => {
    const { service } = buildService({ link: null });

    await expect(service.remove('empresa-1', 'prod-9', 'vinc-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
