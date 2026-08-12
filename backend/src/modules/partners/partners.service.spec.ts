import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PersonType } from '@prisma/client';
import { PartnersService } from './partners.service';
import { ReferencesService } from '../../common/references/references.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePartnerDto } from './dto/create-partner.dto';
import { PartnerRole } from './dto/query-partner.dto';

const PARTNER = {
  id: 'parc-1',
  companyId: 'empresa-1',
  personType: PersonType.PJ,
  legalName: 'Fornecedora Alfa Ltda',
  cnpj: '11222333000181',
  cpf: null,
  foreignDocument: null,
  isCustomer: false,
  isSupplier: true,
  isActive: true,
};

function buildService(partner: Record<string, unknown> | null = PARTNER) {
  const partnerDelegate = {
    create: jest.fn().mockResolvedValue(PARTNER),
    findFirst: jest.fn().mockResolvedValue(partner),
    findMany: jest.fn().mockResolvedValue([PARTNER]),
    count: jest.fn().mockResolvedValue(1),
    update: jest.fn().mockResolvedValue(PARTNER),
  };
  const customerDelegate = { upsert: jest.fn().mockResolvedValue({ partnerId: 'parc-1' }) };
  const supplierDelegate = { upsert: jest.fn().mockResolvedValue({ partnerId: 'parc-1' }) };

  const prisma = {
    db: { partner: partnerDelegate, customer: customerDelegate, supplier: supplierDelegate },
    transaction: <T>(fn: () => Promise<T>) => fn(),
  } as unknown as PrismaService;

  const references = {
    assert: jest.fn().mockResolvedValue(undefined),
  } as unknown as ReferencesService;

  return {
    service: new PartnersService(prisma, references),
    partnerDelegate,
    customerDelegate,
    supplierDelegate,
    references,
  };
}

function createDto(overrides: Partial<CreatePartnerDto> = {}): CreatePartnerDto {
  return {
    personType: PersonType.PJ,
    legalName: 'Fornecedora Alfa Ltda',
    cnpj: '11222333000181',
    isSupplier: true,
    ...overrides,
  } as CreatePartnerDto;
}

describe('PartnersService', () => {
  // RF-022/RF-023: o cadastro só existe para exercer um papel; sem papel, ele
  // não aparece em nenhuma consulta de compra ou venda e vira lixo cadastral.
  it('recusa parceiro sem papel de cliente ou fornecedor', async () => {
    const { service } = buildService();

    await expect(
      service.create('empresa-1', createDto({ isCustomer: false, isSupplier: false })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('exige CNPJ para pessoa jurídica', async () => {
    const { service } = buildService();

    await expect(
      service.create('empresa-1', createDto({ cnpj: undefined })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('exige CPF para pessoa física', async () => {
    const { service } = buildService();

    await expect(
      service.create(
        'empresa-1',
        createDto({ personType: PersonType.PF, cnpj: undefined, cpf: undefined }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('cria o perfil apenas dos papéis habilitados', async () => {
    const { service, customerDelegate, supplierDelegate } = buildService();

    await service.create('empresa-1', createDto({ supplier: { deliveryDays: 7 } }));

    expect(supplierDelegate.upsert).toHaveBeenCalled();
    expect(customerDelegate.upsert).not.toHaveBeenCalled();
  });

  // Bloquear sem motivo trava o parceiro sem deixar rastro de por quê.
  it('recusa bloqueio sem motivo', async () => {
    const { service } = buildService();

    await expect(
      service.create('empresa-1', createDto({ supplier: { isBlocked: true } })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('valida as referências do perfil dentro da empresa', async () => {
    const { service, references } = buildService();

    await service.create(
      'empresa-1',
      createDto({ supplier: { paymentTermId: 'cond-1', paymentMethodId: 'forma-1' } }),
    );

    expect(references.assert).toHaveBeenCalledWith(
      'empresa-1',
      expect.objectContaining({ paymentTermId: 'cond-1', paymentMethodId: 'forma-1' }),
    );
  });

  // RN-001: o recorte por empresa é do servidor.
  it('filtra pela empresa ativa e pelo papel na listagem', async () => {
    const { service, partnerDelegate } = buildService();

    await service.findAll('empresa-1', {
      page: 1,
      pageSize: 20,
      skip: 0,
      take: 20,
      role: PartnerRole.FORNECEDOR,
    } as never);

    expect(partnerDelegate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: 'empresa-1', isSupplier: true }),
      }),
    );
  });

  it('não encontra parceiro de outra empresa', async () => {
    const { service } = buildService(null);

    await expect(service.findOne('empresa-2', 'parc-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  // RN-009: parceiro com títulos e pedidos não é apagado.
  it('inativa em vez de remover', async () => {
    const { service, partnerDelegate } = buildService();

    await service.remove('empresa-1', 'parc-1');

    expect(partnerDelegate.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isActive: false } }),
    );
  });
});
