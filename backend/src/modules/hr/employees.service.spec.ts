import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { EmployeeStatus, HrEventType } from '@prisma/client';
import { EmployeesService } from './employees.service';
import { ReferencesService } from '../../common/references/references.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';

const EMPLOYEE = {
  id: 'func-1',
  companyId: 'empresa-1',
  registration: '0001',
  name: 'Maria Souza',
  taxId: '52998224725',
  status: EmployeeStatus.ATIVO,
  hireDate: new Date('2026-01-05T00:00:00.000Z'),
  terminationDate: null,
};

function buildService(employee: Record<string, unknown> | null = EMPLOYEE) {
  const employeeDelegate = {
    create: jest.fn().mockResolvedValue(EMPLOYEE),
    findFirst: jest.fn().mockResolvedValue(employee),
    findMany: jest.fn().mockResolvedValue([EMPLOYEE]),
    count: jest.fn().mockResolvedValue(1),
    update: jest.fn().mockResolvedValue(EMPLOYEE),
  };
  const eventDelegate = { create: jest.fn().mockResolvedValue({ id: 'evt-1' }) };

  const prisma = {
    db: { employee: employeeDelegate, employeeEvent: eventDelegate },
    transaction: <T>(fn: () => Promise<T>) => fn(),
  } as unknown as PrismaService;

  const references = {
    assert: jest.fn().mockResolvedValue(undefined),
    assertUserBelongsToCompany: jest.fn().mockResolvedValue(undefined),
  } as unknown as ReferencesService;

  return {
    service: new EmployeesService(prisma, references),
    employeeDelegate,
    eventDelegate,
    references,
  };
}

function createDto(overrides: Partial<CreateEmployeeDto> = {}): CreateEmployeeDto {
  return {
    registration: '0001',
    name: 'Maria Souza',
    taxId: '52998224725',
    hireDate: '2026-01-05',
    ...overrides,
  } as CreateEmployeeDto;
}

describe('EmployeesService', () => {
  // RF-015: a admissão precisa abrir o histórico, senão a situação do
  // funcionário passaria a ser um campo solto, sem fato que a explique.
  it('registra o evento de admissão ao cadastrar', async () => {
    const { service, eventDelegate } = buildService();

    await service.create('empresa-1', createDto({ baseSalary: '4500.00' }), 'user-1');

    expect(eventDelegate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: HrEventType.ADMISSAO,
          employeeId: 'func-1',
          recordedBy: 'user-1',
        }),
      }),
    );
  });

  it('recusa nascimento posterior à admissão', async () => {
    const { service } = buildService();

    await expect(
      service.create('empresa-1', createDto({ birthDate: '2026-06-01' })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // RN-001: o recorte por empresa é do servidor.
  it('filtra pela empresa ativa na listagem', async () => {
    const { service, employeeDelegate } = buildService();

    await service.findAll('empresa-1', { page: 1, pageSize: 20, skip: 0, take: 20 } as never);

    expect(employeeDelegate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: 'empresa-1' }) }),
    );
  });

  it('não encontra funcionário de outra empresa', async () => {
    const { service } = buildService(null);

    await expect(service.findOne('empresa-2', 'func-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('recusa o funcionário como próprio gestor', async () => {
    const { service } = buildService();

    await expect(
      service.update('empresa-1', 'func-1', { managerId: 'func-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  describe('desligamento (RF-015)', () => {
    it('registra o evento e grava o motivo no cadastro', async () => {
      const { service, eventDelegate, employeeDelegate } = buildService();

      await service.terminate(
        'empresa-1',
        'func-1',
        { terminationDate: '2026-03-31', reason: 'Pedido de demissão' },
        'user-1',
      );

      expect(eventDelegate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: HrEventType.DESLIGAMENTO }),
        }),
      );
      expect(employeeDelegate.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { terminationReason: 'Pedido de demissão' } }),
      );
    });

    it('recusa data anterior à admissão', async () => {
      const { service } = buildService();

      await expect(
        service.terminate('empresa-1', 'func-1', {
          terminationDate: '2025-12-31',
          reason: 'Erro de digitação',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('recusa desligar quem já está desligado', async () => {
      const { service } = buildService({ ...EMPLOYEE, status: EmployeeStatus.DESLIGADO });

      await expect(
        service.terminate('empresa-1', 'func-1', {
          terminationDate: '2026-04-01',
          reason: 'Duplicidade',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
