import { AuditEvent } from '@prisma/client';
import { AuditService, AUDIT_ENTITY } from './audit.service';
import { PrismaService, RequestMetadata } from '../../prisma/prisma.service';

const META: RequestMetadata = {
  origin: 'API',
  ip: '203.0.113.7',
  userAgent: 'jest',
  correlationId: 'corr-1',
};

function buildService(overrides: Partial<Record<string, unknown>> = {}) {
  const txCreate = jest.fn().mockResolvedValue({ count: 1 });
  const rootCreate = jest.fn().mockResolvedValue({ count: 1 });
  const prisma = {
    db: { auditLog: { createMany: txCreate } },
    root: { auditLog: { createMany: rootCreate } },
    currentRequestMetadata: META,
    currentCompanyId: 'empresa-1',
    currentUser: { id: 'u1', name: 'Fulano' },
    ...overrides,
  } as unknown as PrismaService;
  return { audit: new AuditService(prisma), txCreate, rootCreate };
}

describe('AuditService', () => {
  it('grava o evento na transação da requisição', async () => {
    const { audit, txCreate, rootCreate } = buildService();

    await audit.record({
      event: AuditEvent.LOGIN,
      entity: AUDIT_ENTITY.USER,
      entityId: 'u1',
    });

    expect(rootCreate).not.toHaveBeenCalled();
    expect(txCreate).toHaveBeenCalledTimes(1);
  });

  // RF-115: um INSERT direto não passa pelo trigger, então as colunas de origem
  // precisam ser preenchidas pelo serviço.
  it('preenche origem, ip, user agent e correlation id da requisição', async () => {
    const { audit, txCreate } = buildService();

    await audit.record({ event: AuditEvent.APROVACAO, entity: 'titulo', entityId: 't1' });

    expect(txCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        origin: 'API',
        ip: '203.0.113.7',
        userAgent: 'jest',
        correlationId: 'corr-1',
        companyId: 'empresa-1',
        userId: 'u1',
        userName: 'Fulano',
      }),
    });
  });

  it('deixa o autor explícito prevalecer sobre o da sessão', async () => {
    const { audit, rootCreate } = buildService();

    await audit.recordOutOfBand({
      event: AuditEvent.ACESSO_NEGADO,
      entity: AUDIT_ENTITY.USER,
      userId: 'outro',
      userName: 'Beltrano',
    });

    expect(rootCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'outro', userName: 'Beltrano' }),
    });
  });

  // A transação da requisição é revertida em resposta 4xx: um acesso negado
  // gravado nela desapareceria justamente quando mais importa (RF-114).
  it('grava evento de segurança fora da transação', async () => {
    const { audit, txCreate, rootCreate } = buildService();

    await audit.recordOutOfBand({
      event: AuditEvent.ACESSO_NEGADO,
      entity: AUDIT_ENTITY.USER,
      note: 'Falha de autenticação.',
    });

    expect(txCreate).not.toHaveBeenCalled();
    expect(rootCreate).toHaveBeenCalledTimes(1);
  });

  // Auditar é efeito colateral: falhar aqui não pode virar 500 para o usuário.
  it('não propaga falha ao gravar fora da transação', async () => {
    const { audit } = buildService({
      root: { auditLog: { createMany: jest.fn().mockRejectedValue(new Error('banco fora')) } },
    });

    await expect(
      audit.recordOutOfBand({ event: AuditEvent.ACESSO_NEGADO, entity: AUDIT_ENTITY.USER }),
    ).resolves.toBeUndefined();
  });

  // Em contrapartida, a gravação dentro da transação precisa falhar junto: um
  // evento perdido em silêncio quebraria a completude da trilha (RN-010).
  it('propaga falha ao gravar dentro da transação', async () => {
    const { audit } = buildService({
      db: { auditLog: { createMany: jest.fn().mockRejectedValue(new Error('banco fora')) } },
    });

    await expect(
      audit.record({ event: AuditEvent.LOGIN, entity: AUDIT_ENTITY.USER }),
    ).rejects.toThrow('banco fora');
  });
});
