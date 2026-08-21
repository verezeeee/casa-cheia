import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { Prisma, UserRole, type RefreshToken, type User } from '@prisma/client';
import type { HashService } from '../common/crypto/hash.service';
import type { PasswordHasherService } from '../common/crypto/password-hasher.service';
import type { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import type { TokenService } from './token.service';

const NOW = new Date('2026-01-01T00:00:00.000Z');

const USER: User = {
  id: 'user-1',
  email: 'jogador@poker.test',
  passwordHash: 'stored-hash',
  name: 'Jogador',
  document: null,
  phone: null,
  role: UserRole.PLAYER,
  isActive: true,
  emailVerifiedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
};

const REFRESH_ROW: RefreshToken = {
  id: 'refresh-row-1',
  userId: USER.id,
  tokenHash: 'hash-of-raw-token',
  familyId: 'family-1',
  expiresAt: new Date(NOW.getTime() + 60_000),
  revokedAt: null,
  replacedByTokenId: null,
  userAgent: null,
  ip: null,
  createdAt: NOW,
};

/** Fake mínimo de `PrismaService`: só o que `AuthService` usa. */
function buildPrisma() {
  const tx = {
    user: { create: jest.fn() },
    wallet: { create: jest.fn() },
    refreshToken: { create: jest.fn(), update: jest.fn() },
  };

  return {
    tx,
    user: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    refreshToken: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
  };
}

function buildService(overrides?: {
  prisma?: ReturnType<typeof buildPrisma>;
  passwordValid?: boolean;
}) {
  const prisma = overrides?.prisma ?? buildPrisma();

  const passwordHasher: jest.Mocked<
    Pick<PasswordHasherService, 'hash' | 'verify'>
  > = {
    hash: jest.fn().mockResolvedValue('hashed-password'),
    verify: jest.fn().mockResolvedValue(overrides?.passwordValid ?? true),
  };

  const hashService: jest.Mocked<Pick<HashService, 'sha256'>> = {
    sha256: jest.fn().mockReturnValue('hash-of-raw-token'),
  };

  const tokenService: jest.Mocked<
    Pick<
      TokenService,
      | 'signAccessToken'
      | 'signRefreshToken'
      | 'verifyRefreshToken'
      | 'verifyAccessToken'
    >
  > = {
    signAccessToken: jest
      .fn()
      .mockReturnValue({ token: 'access-token', expiresIn: 900 }),
    signRefreshToken: jest.fn().mockReturnValue({
      token: 'raw-refresh-token',
      jti: 'jti-1',
      expiresAt: new Date(NOW.getTime() + 60_000),
    }),
    verifyRefreshToken: jest.fn(),
    verifyAccessToken: jest.fn(),
  };

  const service = new AuthService(
    prisma as unknown as PrismaService,
    passwordHasher,
    hashService,
    tokenService as unknown as TokenService,
  );

  return { service, prisma, passwordHasher, hashService, tokenService };
}

describe('AuthService', () => {
  describe('register', () => {
    it('cria o usuário e a carteira (balance 0) na mesma transação', async () => {
      const { service, prisma, passwordHasher } = buildService();
      prisma.tx.user.create.mockResolvedValue(USER);

      const result = await service.register({
        email: 'Jogador@Poker.test',
        password: 'senha-forte-123',
        name: 'Jogador',
      });

      expect(passwordHasher.hash).toHaveBeenCalledWith('senha-forte-123');
      expect(prisma.tx.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ email: 'jogador@poker.test' }),
        }),
      );
      expect(prisma.tx.wallet.create).toHaveBeenCalledWith({
        data: { userId: USER.id },
      });
      expect(result).toEqual({
        id: USER.id,
        email: USER.email,
        name: USER.name,
        role: USER.role,
      });
    });

    it('mapeia e-mail duplicado (P2002) para ConflictException', async () => {
      const { service, prisma } = buildService();
      prisma.tx.user.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicate', {
          code: 'P2002',
          clientVersion: '6.19.3',
          meta: { target: ['email'] },
        }),
      );

      await expect(
        service.register({
          email: 'x@y.test',
          password: 'senha-forte-123',
          name: 'X',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('login', () => {
    it('rejeita quando o usuário não existe, mas ainda assim verifica uma senha (mitiga timing)', async () => {
      const { service, prisma, passwordHasher } = buildService();
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login(
          { email: 'ninguem@poker.test', password: 'qualquer' },
          {},
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(passwordHasher.verify).toHaveBeenCalled();
    });

    it('rejeita usuário inativo mesmo com senha correta', async () => {
      const { service, prisma } = buildService({ passwordValid: true });
      prisma.user.findUnique.mockResolvedValue({ ...USER, isActive: false });

      await expect(
        service.login({ email: USER.email, password: 'correta' }, {}),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('emite tokens e persiste o refresh token em caso de sucesso', async () => {
      const { service, prisma } = buildService({ passwordValid: true });
      prisma.user.findUnique.mockResolvedValue(USER);
      prisma.tx.refreshToken.create.mockResolvedValue({ id: 'new-row' });

      const result = await service.login(
        { email: USER.email, password: 'correta' },
        { ip: '1.2.3.4' },
      );

      expect(result.tokens).toEqual({
        accessToken: 'access-token',
        expiresIn: 900,
      });
      expect(result.refreshToken).toBe('raw-refresh-token');
      expect(prisma.tx.refreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: USER.id,
            tokenHash: 'hash-of-raw-token',
            ip: '1.2.3.4',
          }),
        }),
      );
    });
  });

  describe('refresh', () => {
    it('rejeita token com assinatura/expiração inválida', async () => {
      const { service, tokenService } = buildService();
      tokenService.verifyRefreshToken.mockImplementation(() => {
        throw new Error('invalid');
      });

      await expect(service.refresh('bad-token', {})).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('detecta reuso de token revogado e derruba a família inteira', async () => {
      const { service, prisma, tokenService } = buildService();
      tokenService.verifyRefreshToken.mockReturnValue({
        sub: USER.id,
        email: USER.email,
        role: USER.role,
        familyId: REFRESH_ROW.familyId,
        jti: 'jti-x',
        iat: 0,
        exp: 0,
      });
      prisma.refreshToken.findUnique.mockResolvedValue({
        ...REFRESH_ROW,
        revokedAt: NOW,
      });

      await expect(
        service.refresh('raw-refresh-token', {}),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { familyId: REFRESH_ROW.familyId, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('rotaciona com sucesso: revoga o token anterior e emite um novo', async () => {
      const { service, prisma, tokenService } = buildService();
      tokenService.verifyRefreshToken.mockReturnValue({
        sub: USER.id,
        email: USER.email,
        role: USER.role,
        familyId: REFRESH_ROW.familyId,
        jti: 'jti-x',
        iat: 0,
        exp: 0,
      });
      prisma.refreshToken.findUnique.mockResolvedValue(REFRESH_ROW);
      prisma.user.findUnique.mockResolvedValue(USER);
      prisma.tx.refreshToken.create.mockResolvedValue({ id: 'new-row-id' });

      const result = await service.refresh('raw-refresh-token', {});

      expect(result.tokens.accessToken).toBe('access-token');
      expect(prisma.tx.refreshToken.update).toHaveBeenCalledWith({
        where: { id: REFRESH_ROW.id },
        data: { revokedAt: expect.any(Date), replacedByTokenId: 'new-row-id' },
      });
    });
  });

  describe('logout', () => {
    it('não faz nada sem token', async () => {
      const { service, prisma } = buildService();
      await service.logout(undefined);
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('revoga o token correspondente ao hash', async () => {
      const { service, prisma } = buildService();
      await service.logout('raw-refresh-token');
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { tokenHash: 'hash-of-raw-token', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });

  describe('me', () => {
    it('devolve a projeção pública do usuário', async () => {
      const { service, prisma } = buildService();
      prisma.user.findUniqueOrThrow.mockResolvedValue(USER);

      await expect(service.me(USER.id)).resolves.toEqual({
        id: USER.id,
        email: USER.email,
        name: USER.name,
        role: USER.role,
      });
    });
  });
});
