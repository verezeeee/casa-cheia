import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { PasswordHasherService } from '../common/crypto/password-hasher.service';
import type { PrismaService } from '../prisma/prisma.service';
import { ClubService } from './club.service';

const CLUBE = {
  id: 'clube-1',
  name: 'Casa Cheia',
  document: '12345678000199',
  status: 'ACTIVE' as const,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

const MEMBERSHIP = {
  id: 'mem-1',
  clubeId: CLUBE.id,
  userId: 'user-1',
  role: 'ADMIN' as const,
  status: 'ACTIVE' as const,
  createdAt: new Date('2026-01-02T00:00:00.000Z'),
};

function buildService() {
  const tx = {
    user: { create: jest.fn() },
    clube: { create: jest.fn() },
    clubeMembership: { create: jest.fn(), upsert: jest.fn() },
    wallet: { create: jest.fn(), upsert: jest.fn() },
  };
  const prisma = {
    clube: { findUnique: jest.fn() },
    clubeMembership: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    user: { findUnique: jest.fn() },
    // `createMemberWithNewUser` abre a transação por aqui — o mock aceita e
    // roda o callback contra o MESMO `tx` acima, igual `withClube` alhures.
    $transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
  };
  const passwordHasher = { hash: jest.fn().mockResolvedValue('hash-fake') };
  const service = new ClubService(
    prisma as unknown as PrismaService,
    passwordHasher as unknown as PasswordHasherService,
  );
  return { service, prisma, tx, passwordHasher };
}

describe('ClubService', () => {
  describe('listMyClubes', () => {
    it('varre os vínculos ACTIVE do próprio usuário (única query cross-clube)', async () => {
      const { service, prisma } = buildService();
      prisma.clubeMembership.findMany.mockResolvedValue([
        { ...MEMBERSHIP, clube: CLUBE },
      ]);

      await expect(service.listMyClubes('user-1')).resolves.toEqual([
        { id: CLUBE.id, name: CLUBE.name, status: 'ACTIVE', role: 'ADMIN' },
      ]);
      expect(prisma.clubeMembership.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', status: 'ACTIVE' },
        }),
      );
    });

    it('mantém na lista o clube SUSPENDED (bloqueio é operacional, não de visibilidade)', async () => {
      const { service, prisma } = buildService();
      prisma.clubeMembership.findMany.mockResolvedValue([
        {
          ...MEMBERSHIP,
          role: 'PLAYER',
          clube: { ...CLUBE, status: 'SUSPENDED' },
        },
      ]);

      const [clube] = await service.listMyClubes('user-1');
      expect(clube).toMatchObject({ status: 'SUSPENDED', role: 'PLAYER' });
    });

    it('não inclui joinCode pra quem não é ADMIN', async () => {
      const { service, prisma } = buildService();
      prisma.clubeMembership.findMany.mockResolvedValue([
        { ...MEMBERSHIP, role: 'PLAYER', clube: CLUBE },
      ]);

      const [clube] = await service.listMyClubes('user-1');
      expect(clube).not.toHaveProperty('joinCode');
    });
  });

  describe('createClube', () => {
    it('cria clube + vínculo ADMIN + carteira numa transação, com joinCode', async () => {
      const { service, prisma, tx } = buildService();
      tx.clube.create.mockResolvedValue({ ...CLUBE, joinCode: '123456' });
      tx.clubeMembership.create.mockResolvedValue(MEMBERSHIP);

      const result = await service.createClube('user-1', {
        name: CLUBE.name,
        document: CLUBE.document,
      });

      expect(tx.clube.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: CLUBE.name,
          document: CLUBE.document,
          joinCode: expect.stringMatching(/^\d{6}$/) as unknown,
        }),
      });
      expect(tx.clubeMembership.create).toHaveBeenCalledWith({
        data: {
          clubeId: CLUBE.id,
          userId: 'user-1',
          role: 'ADMIN',
          status: 'ACTIVE',
        },
      });
      expect(tx.wallet.create).toHaveBeenCalledWith({
        data: { userId: 'user-1', clubeId: CLUBE.id },
      });
      expect(result).toMatchObject({
        id: CLUBE.id,
        role: 'ADMIN',
        joinCode: '123456',
      });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('colisão de joinCode (auto-gerado) regenera e tenta de novo, sem vazar erro', async () => {
      const { service, prisma, tx } = buildService();
      const { Prisma } = jest.requireActual('../generated/prisma');
      tx.clube.create.mockResolvedValue({ ...CLUBE, joinCode: '654321' });
      tx.clubeMembership.create.mockResolvedValue(MEMBERSHIP);

      prisma.$transaction
        .mockImplementationOnce(() => {
          throw new Prisma.PrismaClientKnownRequestError('duplicate', {
            code: 'P2002',
            clientVersion: '6.19.3',
            meta: { target: ['join_code'] },
          });
        })
        .mockImplementation((cb: (t: typeof tx) => unknown) => cb(tx));

      await expect(
        service.createClube('user-1', {
          name: CLUBE.name,
          document: CLUBE.document,
        }),
      ).resolves.toMatchObject({ id: CLUBE.id });
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    });

    it('documento já cadastrado (input do usuário) mapeia pra 409, sem retry', async () => {
      const { service, prisma } = buildService();
      const { Prisma } = jest.requireActual('../generated/prisma');
      prisma.$transaction.mockImplementation(() => {
        throw new Prisma.PrismaClientKnownRequestError('duplicate', {
          code: 'P2002',
          clientVersion: '6.19.3',
          meta: { target: ['document'] },
        });
      });

      await expect(
        service.createClube('user-1', {
          name: CLUBE.name,
          document: CLUBE.document,
        }),
      ).rejects.toThrow('Documento já cadastrado.');
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('joinByCode', () => {
    it('código inexistente responde 404', async () => {
      const { service, prisma } = buildService();
      prisma.clube.findUnique.mockResolvedValue(null);

      await expect(
        service.joinByCode('user-1', { code: '999999' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('código válido cria vínculo PLAYER ativo + carteira (upsert, idempotente)', async () => {
      const { service, prisma, tx } = buildService();
      prisma.clube.findUnique.mockResolvedValue({
        ...CLUBE,
        joinCode: '123456',
      });
      tx.clubeMembership.upsert.mockResolvedValue({
        ...MEMBERSHIP,
        role: 'PLAYER',
      });

      const result = await service.joinByCode('user-2', { code: '123456' });

      expect(tx.clubeMembership.upsert).toHaveBeenCalledWith({
        where: { clubeId_userId: { clubeId: CLUBE.id, userId: 'user-2' } },
        create: {
          clubeId: CLUBE.id,
          userId: 'user-2',
          role: 'PLAYER',
          status: 'ACTIVE',
        },
        update: { status: 'ACTIVE' },
      });
      expect(tx.wallet.upsert).toHaveBeenCalledWith({
        where: { userId_clubeId: { userId: 'user-2', clubeId: CLUBE.id } },
        create: { userId: 'user-2', clubeId: CLUBE.id },
        update: {},
      });
      expect(result).toMatchObject({ id: CLUBE.id, role: 'PLAYER' });
      expect(result).not.toHaveProperty('joinCode');
    });
  });

  describe('getClube', () => {
    it('retorna o clube quando há vínculo ACTIVE', async () => {
      const { service, prisma } = buildService();
      prisma.clubeMembership.findUnique.mockResolvedValue({
        ...MEMBERSHIP,
        clube: CLUBE,
      });

      await expect(service.getClube('user-1', CLUBE.id)).resolves.toMatchObject(
        { id: CLUBE.id, role: 'ADMIN' },
      );
      expect(prisma.clubeMembership.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { clubeId_userId: { clubeId: CLUBE.id, userId: 'user-1' } },
        }),
      );
    });

    it('sem vínculo, responde 404 (não 403: não revela a existência do clube)', async () => {
      const { service, prisma } = buildService();
      prisma.clubeMembership.findUnique.mockResolvedValue(null);

      await expect(service.getClube('user-2', CLUBE.id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('vínculo REVOKED equivale a não ter vínculo (404)', async () => {
      const { service, prisma } = buildService();
      prisma.clubeMembership.findUnique.mockResolvedValue({
        ...MEMBERSHIP,
        status: 'REVOKED',
        clube: CLUBE,
      });

      await expect(service.getClube('user-1', CLUBE.id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('listMembers', () => {
    it('lista os membros quando o requisitante é ADMIN ativo', async () => {
      const { service, prisma } = buildService();
      prisma.clubeMembership.findUnique.mockResolvedValue({
        role: 'ADMIN',
        status: 'ACTIVE',
      });
      prisma.clubeMembership.findMany.mockResolvedValue([
        { ...MEMBERSHIP, user: { name: 'Admin', email: 'admin@casa.dev' } },
      ]);

      await expect(service.listMembers('user-1', CLUBE.id)).resolves.toEqual([
        {
          id: MEMBERSHIP.id,
          userId: MEMBERSHIP.userId,
          name: 'Admin',
          email: 'admin@casa.dev',
          role: 'ADMIN',
          status: 'ACTIVE',
          createdAt: MEMBERSHIP.createdAt.toISOString(),
        },
      ]);
    });

    it('membro sem papel de ADMIN recebe 403', async () => {
      const { service, prisma } = buildService();
      prisma.clubeMembership.findUnique.mockResolvedValue({
        role: 'PLAYER',
        status: 'ACTIVE',
      });

      await expect(
        service.listMembers('user-9', CLUBE.id),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.clubeMembership.findMany).not.toHaveBeenCalled();
    });

    it('quem não é membro recebe 404, não 403', async () => {
      const { service, prisma } = buildService();
      prisma.clubeMembership.findUnique.mockResolvedValue(null);

      await expect(
        service.listMembers('estranho', CLUBE.id),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('upsertMember', () => {
    function asAdmin(prisma: ReturnType<typeof buildService>['prisma']) {
      prisma.clubeMembership.findUnique.mockResolvedValue({
        role: 'ADMIN',
        status: 'ACTIVE',
      });
    }

    it('cria/atualiza o vínculo e devolve o membro', async () => {
      const { service, prisma } = buildService();
      asAdmin(prisma);
      prisma.user.findUnique.mockResolvedValue({
        name: 'Novato',
        email: 'novato@casa.dev',
      });
      prisma.clubeMembership.upsert.mockResolvedValue({
        ...MEMBERSHIP,
        id: 'mem-2',
        userId: 'user-2',
        role: 'CASHIER',
      });

      await expect(
        service.upsertMember('user-1', CLUBE.id, {
          userId: 'user-2',
          role: 'CASHIER',
        }),
      ).resolves.toMatchObject({ userId: 'user-2', role: 'CASHIER' });

      expect(prisma.clubeMembership.upsert).toHaveBeenCalledWith({
        where: { clubeId_userId: { clubeId: CLUBE.id, userId: 'user-2' } },
        create: {
          clubeId: CLUBE.id,
          userId: 'user-2',
          role: 'CASHIER',
          status: 'ACTIVE',
        },
        update: { role: 'CASHIER', status: 'ACTIVE' },
      });
    });

    it('usuário inexistente responde 404 antes de tocar no vínculo', async () => {
      const { service, prisma } = buildService();
      asAdmin(prisma);
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.upsertMember('user-1', CLUBE.id, {
          userId: 'fantasma',
          role: 'PLAYER',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.clubeMembership.upsert).not.toHaveBeenCalled();
    });

    it('impede o admin de rebaixar a si mesmo (anti-lockout)', async () => {
      const { service, prisma } = buildService();
      asAdmin(prisma);

      await expect(
        service.upsertMember('user-1', CLUBE.id, {
          userId: 'user-1',
          role: 'PLAYER',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.clubeMembership.upsert).not.toHaveBeenCalled();
    });

    it('impede o admin de revogar a si mesmo (anti-lockout)', async () => {
      const { service, prisma } = buildService();
      asAdmin(prisma);

      await expect(
        service.upsertMember('user-1', CLUBE.id, {
          userId: 'user-1',
          role: 'ADMIN',
          status: 'REVOKED',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('não-ADMIN recebe 403 e nada é escrito', async () => {
      const { service, prisma } = buildService();
      prisma.clubeMembership.findUnique.mockResolvedValue({
        role: 'TOURNAMENT_DIRECTOR',
        status: 'ACTIVE',
      });

      await expect(
        service.upsertMember('user-9', CLUBE.id, {
          userId: 'user-2',
          role: 'ADMIN',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.clubeMembership.upsert).not.toHaveBeenCalled();
    });

    it('rejeita quando manda userId E email/name ao mesmo tempo', async () => {
      const { service, prisma } = buildService();
      asAdmin(prisma);

      await expect(
        service.upsertMember('user-1', CLUBE.id, {
          userId: 'user-2',
          email: 'novo@casa.dev',
          name: 'Novo',
          role: 'PLAYER',
        } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.clubeMembership.upsert).not.toHaveBeenCalled();
    });

    it('rejeita quando não manda nem userId nem email/name', async () => {
      const { service, prisma } = buildService();
      asAdmin(prisma);

      await expect(
        service.upsertMember('user-1', CLUBE.id, { role: 'PLAYER' } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejeita email sem name (cadastro incompleto)', async () => {
      const { service, prisma } = buildService();
      asAdmin(prisma);

      await expect(
        service.upsertMember('user-1', CLUBE.id, {
          email: 'novo@casa.dev',
          role: 'PLAYER',
        } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    describe('cadastro de usuário novo (email + name, sem userId)', () => {
      it('cria conta + vínculo + carteira numa transação, e devolve temporaryPassword', async () => {
        const { service, prisma, tx, passwordHasher } = buildService();
        asAdmin(prisma);
        tx.user.create.mockResolvedValue({
          id: 'user-novo',
          name: 'Jogador Novo',
          email: 'jogador@casa.dev',
        });
        tx.clubeMembership.create.mockResolvedValue({
          ...MEMBERSHIP,
          id: 'mem-novo',
          userId: 'user-novo',
          role: 'PLAYER',
        });

        const result = await service.upsertMember('user-1', CLUBE.id, {
          email: '  Jogador@Casa.dev  ',
          name: 'Jogador Novo',
          role: 'PLAYER',
        } as never);

        // E-mail normalizado (trim + lowercase) antes de gravar.
        expect(tx.user.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            email: 'jogador@casa.dev',
            name: 'Jogador Novo',
            passwordHash: 'hash-fake',
          }),
        });
        expect(passwordHasher.hash).toHaveBeenCalledWith(
          expect.stringMatching(/^[\w-]{10,}$/) as unknown,
        );
        expect(tx.clubeMembership.create).toHaveBeenCalledWith({
          data: {
            clubeId: CLUBE.id,
            userId: 'user-novo',
            role: 'PLAYER',
            status: 'ACTIVE',
          },
        });
        expect(tx.wallet.create).toHaveBeenCalledWith({
          data: { userId: 'user-novo', clubeId: CLUBE.id },
        });
        expect(result).toMatchObject({
          userId: 'user-novo',
          name: 'Jogador Novo',
          email: 'jogador@casa.dev',
        });
        expect(typeof result.temporaryPassword).toBe('string');
        expect(result.temporaryPassword!.length).toBeGreaterThanOrEqual(10);
      });

      it('mapeia e-mail já cadastrado para 409, sem vazar detalhe do banco', async () => {
        const { service, prisma, tx } = buildService();
        asAdmin(prisma);
        const { Prisma } = jest.requireActual('../generated/prisma');
        tx.user.create.mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError('duplicate', {
            code: 'P2002',
            clientVersion: '6.19.3',
            meta: { target: ['email'] },
          }),
        );

        await expect(
          service.upsertMember('user-1', CLUBE.id, {
            email: 'ja-existe@casa.dev',
            name: 'Duplicado',
            role: 'PLAYER',
          } as never),
        ).rejects.toThrow('E-mail já cadastrado.');
      });

      it('não passa pela trava anti-lockout (dto.userId indefinido nunca é o admin)', async () => {
        const { service, prisma, tx } = buildService();
        asAdmin(prisma);
        tx.user.create.mockResolvedValue({
          id: 'user-novo',
          name: 'X',
          email: 'x@casa.dev',
        });
        tx.clubeMembership.create.mockResolvedValue({
          ...MEMBERSHIP,
          userId: 'user-novo',
          role: 'PLAYER',
        });

        // `status: 'REVOKED'` seria bloqueado pela trava SE fosse o próprio
        // admin (dto.userId === userId) — aqui não é, então passa.
        await expect(
          service.upsertMember('user-1', CLUBE.id, {
            email: 'x@casa.dev',
            name: 'X',
            role: 'PLAYER',
            status: 'REVOKED',
          } as never),
        ).resolves.toBeDefined();
      });
    });
  });
});
