import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';
import { PrismaService } from '../../../prisma/prisma.service';
import { AccessTokenPayload } from '../../../common/authorization/authenticated-user';

const NOW = new Date('2026-08-10T12:00:00Z');
const iatOf = (date: Date) => Math.floor(date.getTime() / 1000);

function buildStrategy(user: unknown) {
  const config = { getOrThrow: () => 'segredo-de-teste-com-16+' } as unknown as ConfigService;
  const setCurrentUser = jest.fn().mockResolvedValue(undefined);
  const prisma = {
    db: { user: { findUnique: jest.fn().mockResolvedValue(user) } },
    setCurrentUser,
  } as unknown as PrismaService;
  return { strategy: new JwtStrategy(config, prisma), setCurrentUser };
}

const payload = (iat: number): AccessTokenPayload => ({
  sub: 'u1',
  email: 'a@b.c',
  isSuperAdmin: false,
  iat,
});

const activeUser = {
  id: 'u1',
  email: 'a@b.c',
  isSuperAdmin: false,
  isActive: true,
  passwordChangedAt: null as Date | null,
};

describe('JwtStrategy', () => {
  it('aceita token de usuário ativo', async () => {
    const { strategy, setCurrentUser } = buildStrategy(activeUser);
    await expect(strategy.validate(payload(iatOf(NOW)))).resolves.toEqual({
      id: 'u1',
      email: 'a@b.c',
      isSuperAdmin: false,
    });
    // Identifica a sessão de banco para a auditoria e a RLS (RN-010).
    expect(setCurrentUser).toHaveBeenCalledWith('u1');
  });

  it('rejeita usuário inativo (RF-007)', async () => {
    const { strategy } = buildStrategy({ ...activeUser, isActive: false });
    await expect(strategy.validate(payload(iatOf(NOW)))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejeita usuário inexistente', async () => {
    const { strategy } = buildStrategy(null);
    await expect(strategy.validate(payload(iatOf(NOW)))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  // RF-009: revogar as sessões não basta — o access token é stateless e
  // sobreviveria até expirar. `senha_alterada_em` corta os tokens anteriores.
  it('rejeita token emitido antes da troca de senha (RF-009)', async () => {
    const changedAt = new Date(NOW.getTime() + 60_000);
    const { strategy } = buildStrategy({ ...activeUser, passwordChangedAt: changedAt });
    await expect(strategy.validate(payload(iatOf(NOW)))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('aceita token emitido depois da troca de senha', async () => {
    const changedAt = new Date(NOW.getTime() - 60_000);
    const { strategy } = buildStrategy({ ...activeUser, passwordChangedAt: changedAt });
    await expect(strategy.validate(payload(iatOf(NOW)))).resolves.toMatchObject({ id: 'u1' });
  });
});
