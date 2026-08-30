import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { EntriesService } from './entries.service';

const CLUBE_ID = 'clube-1';

function buildPrisma() {
  return {
    tournamentEntry: { findMany: jest.fn().mockResolvedValue([]) },
    tableSession: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

function buildService(prisma = buildPrisma()) {
  const service = new EntriesService(prisma as unknown as PrismaService);
  return { service, prisma };
}

function tournamentRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'entry-1',
    userId: 'user-1',
    registeredAt: new Date('2026-02-01T00:00:00.000Z'),
    status: 'PAID',
    finalPosition: 1,
    prizeAmount: new Prisma.Decimal('120.00'),
    chipStack: 15_000,
    user: { name: 'Jogador' },
    tournament: { name: 'Sunday Major', buyIn: new Prisma.Decimal('90.00') },
    ...overrides,
  };
}

function tableRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'session-1',
    userId: 'user-1',
    joinedAt: new Date('2026-01-15T00:00:00.000Z'),
    status: 'CASHED_OUT',
    totalBuyIn: new Prisma.Decimal('100.00'),
    totalCashOut: new Prisma.Decimal('150.00'),
    currentStack: new Prisma.Decimal('0.00'),
    user: { name: 'Jogador' },
    table: { name: 'Mesa 1' },
    ...overrides,
  };
}

describe('EntriesService', () => {
  describe('listEntries', () => {
    it('mescla torneio + mesa numa lista só, ordenada por data desc', async () => {
      const prisma = buildPrisma();
      prisma.tournamentEntry.findMany.mockResolvedValue([tournamentRow()]);
      prisma.tableSession.findMany.mockResolvedValue([tableRow()]);
      const { service } = buildService(prisma);

      const result = await service.listEntries(
        CLUBE_ID,
        'user-1',
        undefined,
        20,
      );

      expect(result.items).toHaveLength(2);
      // torneio (01/02) é mais recente que mesa (15/01) — vem primeiro.
      expect(result.items[0].kind).toBe('TOURNAMENT');
      expect(result.items[0].label).toBe('Sunday Major');
      expect(result.items[0].prizeAmount).toBe('120.00');
      expect(result.items[1].kind).toBe('TABLE');
      expect(result.items[1].label).toBe('Mesa 1');
      expect(result.items[1].totalCashOut).toBe('150.00');
      // netResult = totalCashOut + currentStack - totalBuyIn = 150 + 0 - 100.
      expect(result.items[1].netResult).toBe('50.00');
      expect(result.nextCursor).toBeNull();
    });

    it('netResult de mesa ACTIVE soma o stack corrente (resultado ainda em aberto)', async () => {
      const prisma = buildPrisma();
      prisma.tableSession.findMany.mockResolvedValue([
        tableRow({
          status: 'ACTIVE',
          totalBuyIn: new Prisma.Decimal('100.00'),
          totalCashOut: new Prisma.Decimal('0.00'),
          currentStack: new Prisma.Decimal('130.00'),
        }),
      ]);
      const { service } = buildService(prisma);

      const result = await service.listEntries(
        CLUBE_ID,
        'user-1',
        undefined,
        20,
      );

      expect(result.items[0].netResult).toBe('30.00');
    });

    it('filtra por userId quando não é admin', async () => {
      const prisma = buildPrisma();
      const { service } = buildService(prisma);

      await service.listEntries(CLUBE_ID, 'user-1', undefined, 20);

      expect(prisma.tournamentEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            clubeId: CLUBE_ID,
            userId: 'user-1',
          }),
        }),
      );
      expect(prisma.tableSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            clubeId: CLUBE_ID,
            userId: 'user-1',
          }),
        }),
      );
    });

    it('userId null (admin) não filtra por jogador', async () => {
      const prisma = buildPrisma();
      const { service } = buildService(prisma);

      await service.listEntries(CLUBE_ID, null, undefined, 20);

      const [tournamentCall] = prisma.tournamentEntry.findMany.mock.calls as [
        [{ where: Record<string, unknown> }],
      ];
      const [tableCall] = prisma.tableSession.findMany.mock.calls as [
        [{ where: Record<string, unknown> }],
      ];
      expect(tournamentCall[0].where).not.toHaveProperty('userId');
      expect(tableCall[0].where).not.toHaveProperty('userId');
    });

    it('pagina: devolve nextCursor quando sobra mais que o limite', async () => {
      const prisma = buildPrisma();
      prisma.tournamentEntry.findMany.mockResolvedValue([
        tournamentRow({
          id: 'e1',
          registeredAt: new Date('2026-02-03T00:00:00.000Z'),
        }),
        tournamentRow({
          id: 'e2',
          registeredAt: new Date('2026-02-02T00:00:00.000Z'),
        }),
      ]);
      prisma.tableSession.findMany.mockResolvedValue([
        tableRow({ id: 's1', joinedAt: new Date('2026-02-01T00:00:00.000Z') }),
      ]);
      const { service } = buildService(prisma);

      const result = await service.listEntries(
        CLUBE_ID,
        'user-1',
        undefined,
        2,
      );

      expect(result.items).toHaveLength(2);
      expect(result.items.map((i) => i.id)).toEqual(['e1', 'e2']);
      expect(result.nextCursor).not.toBeNull();
    });

    it('cursor filtra ambas as fontes por data anterior ao item de corte', async () => {
      const prisma = buildPrisma();
      const { service } = buildService(prisma);
      const cursor = Buffer.from(
        JSON.stringify({ createdAt: '2026-02-02T00:00:00.000Z', id: 'e2' }),
      ).toString('base64url');

      await service.listEntries(CLUBE_ID, 'user-1', cursor, 20);

      const [tournamentCall] = prisma.tournamentEntry.findMany.mock.calls as [
        [{ where: { OR?: unknown[] } }],
      ];
      expect(tournamentCall[0].where.OR).toBeDefined();
    });
  });
});
