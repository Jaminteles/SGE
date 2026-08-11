import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AuditEvent } from '@prisma/client';
import { AuditQueryService } from './audit-query.service';
import { QueryAuditDto } from './dto/query-audit.dto';
import { PrismaService } from '../../prisma/prisma.service';

const ROW = {
  id: 9007199254740993n, // acima de Number.MAX_SAFE_INTEGER de propósito
  companyId: 'empresa-1',
  userId: 'u1',
  userName: 'Fulano',
  event: AuditEvent.ALTERACAO,
  entity: 'titulo',
  entityId: 't1',
  previousValue: { valor: 10 },
  currentValue: { valor: 20 },
  changedFields: ['valor'],
  origin: 'API',
  ip: '203.0.113.7',
  userAgent: 'jest',
  correlationId: 'corr-1',
  note: null,
  occurredAt: new Date('2026-08-24T10:00:00Z'),
};

function buildService(rows = [ROW], total = rows.length) {
  const findMany = jest.fn().mockResolvedValue(rows);
  const findFirst = jest.fn().mockResolvedValue(rows[0] ?? null);
  const count = jest.fn().mockResolvedValue(total);
  const prisma = {
    db: { auditLog: { findMany, findFirst, count } },
  } as unknown as PrismaService;
  return { service: new AuditQueryService(prisma), findMany, findFirst, count };
}

function query(overrides: Partial<QueryAuditDto> = {}): QueryAuditDto {
  return Object.assign(new QueryAuditDto(), overrides);
}

describe('AuditQueryService', () => {
  // RN-001: o recorte por empresa é do servidor, nunca do cliente.
  it('filtra pela empresa ativa mesmo sem filtro do cliente', async () => {
    const { service, findMany } = buildService();

    await service.findAll('empresa-1', query());

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: 'empresa-1' }) }),
    );
  });

  it('traduz o período em intervalo semiaberto', async () => {
    const { service, findMany } = buildService();
    const from = new Date('2026-08-01T00:00:00Z');
    const to = new Date('2026-09-01T00:00:00Z');

    await service.findAll('empresa-1', query({ from, to }));

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ occurredAt: { gte: from, lt: to } }),
      }),
    );
  });

  it('rejeita período invertido', async () => {
    const { service } = buildService();

    await expect(
      service.findAll(
        'empresa-1',
        query({ from: new Date('2026-09-01'), to: new Date('2026-08-01') }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('ordena do evento mais recente para o mais antigo', async () => {
    const { service, findMany } = buildService();

    await service.findAll('empresa-1', query());

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { occurredAt: 'desc' } }),
    );
  });

  // JSON.stringify lança em BigInt: o id precisa sair como string.
  it('serializa o id como string sem perder precisão', async () => {
    const { service } = buildService();

    const result = await service.findAll('empresa-1', query());

    expect(result.data[0].id).toBe('9007199254740993');
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it('devolve valores anterior e posterior (RF-116)', async () => {
    const { service } = buildService();

    const [entry] = (await service.findAll('empresa-1', query())).data;

    expect(entry.previousValue).toEqual({ valor: 10 });
    expect(entry.currentValue).toEqual({ valor: 20 });
    expect(entry.changedFields).toEqual(['valor']);
  });

  it('a rota da entidade sobrescreve o filtro vindo da query', async () => {
    const { service, findMany } = buildService();

    await service.findByEntity('empresa-1', 'titulo', 't1', query({ entity: 'outra' }));

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ entity: 'titulo', entityId: 't1' }),
      }),
    );
  });

  it('recusa id que não é inteiro', async () => {
    const { service } = buildService();

    await expect(service.findOne('empresa-1', 'abc')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('não encontra evento de outra empresa', async () => {
    const { service, findFirst } = buildService();
    findFirst.mockResolvedValue(null);

    await expect(service.findOne('empresa-2', '1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
