import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
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
  const prisma = {
    clubeMembership: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    user: { findUnique: jest.fn() },
  };
  const service = new ClubService(prisma as unknown as PrismaService);
  return { service, prisma };
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
  });
});
