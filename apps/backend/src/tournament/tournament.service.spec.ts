import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { WalletService } from '../wallet/wallet.service';
import { TournamentService } from './tournament.service';

const TOURNAMENT = {
  id: 'trn-1',
  name: 'Sunday Major',
  buyIn: new Prisma.Decimal('90.00'),
  fee: new Prisma.Decimal('10.00'),
  startingStack: 10_000,
  maxPlayers: 4,
  status: 'REGISTERING',
  registrationOpensAt: null,
  startsAt: new Date('2026-02-01T21:00:00.000Z'),
  lateRegUntil: null,
  finishedAt: null,
  prizePool: new Prisma.Decimal('180.00'),
  guaranteedPrize: null,
  createdById: 'admin-1',
  version: 3,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

const WALLET = { id: 'wallet-1', userId: 'user-1' };

function buildPrisma() {
  const tx = {
    tournamentEntry: { create: jest.fn(), update: jest.fn() },
    tournament: { updateMany: jest.fn(), update: jest.fn() },
    wallet: { findUniqueOrThrow: jest.fn() },
  };

  return {
    tx,
    tournament: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    tournamentPrize: { findMany: jest.fn() },
    tournamentEntry: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    walletTransaction: { findUnique: jest.fn() },
    wallet: { findUniqueOrThrow: jest.fn() },
    $transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
  };
}

function buildService(overrides?: { prisma?: ReturnType<typeof buildPrisma> }) {
  const prisma = overrides?.prisma ?? buildPrisma();
  const walletService = { applyLedgerEntry: jest.fn() };

  const service = new TournamentService(
    prisma as unknown as PrismaService,
    walletService as unknown as WalletService,
  );

  return { service, prisma, walletService };
}

describe('TournamentService', () => {
  describe('createTournament', () => {
    const validDto = (
      prizes: Array<{ position: number; percentage: string }>,
    ) => ({
      name: 'Sunday Major',
      buyIn: '90.00',
      fee: '10.00',
      startingStack: 10_000,
      maxPlayers: 100,
      startsAt: '2026-02-01T21:00:00.000Z',
      prizes,
    });

    it('rejeita grade cuja soma de percentuais não fecha 100', async () => {
      const { service } = buildService();
      await expect(
        service.createTournament(
          'admin-1',
          validDto([{ position: 1, percentage: '90.00' }]) as never,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejeita colocações repetidas na grade', async () => {
      const { service } = buildService();
      const dto = validDto([
        { position: 1, percentage: '50.00' },
        { position: 1, percentage: '50.00' },
      ]);
      await expect(
        service.createTournament('admin-1', dto as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('cria o torneio em REGISTERING quando a grade fecha 100', async () => {
      const { service, prisma } = buildService();
      prisma.tournament.create.mockResolvedValue(TOURNAMENT);

      const dto = validDto([
        { position: 1, percentage: '70.00' },
        { position: 2, percentage: '30.00' },
      ]);
      const result = await service.createTournament('admin-1', dto);

      expect(prisma.tournament.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'REGISTERING' }),
        }),
      );
      expect(result.status).toBe('REGISTERING');
    });
  });

  describe('getTournament', () => {
    it('lança 404 quando o torneio não existe', async () => {
      const { service, prisma } = buildService();
      prisma.tournament.findUnique.mockResolvedValue(null);
      await expect(service.getTournament('inexistente')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('registerEntry', () => {
    it('rejeita quando o torneio não está REGISTERING', async () => {
      const { service, prisma } = buildService();
      prisma.walletTransaction.findUnique.mockResolvedValue(null);
      prisma.wallet.findUniqueOrThrow.mockResolvedValue(WALLET);
      prisma.tournament.findUnique.mockResolvedValue({
        ...TOURNAMENT,
        status: 'RUNNING',
      });

      await expect(
        service.registerEntry('user-1', 'trn-1', 'idem-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejeita quando o torneio está lotado', async () => {
      const { service, prisma } = buildService();
      prisma.walletTransaction.findUnique.mockResolvedValue(null);
      prisma.wallet.findUniqueOrThrow.mockResolvedValue(WALLET);
      prisma.tournament.findUnique.mockResolvedValue(TOURNAMENT);
      prisma.tournamentEntry.count.mockResolvedValue(TOURNAMENT.maxPlayers);

      await expect(
        service.registerEntry('user-1', 'trn-1', 'idem-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('devolve a inscrição já existente sem debitar de novo (replay idempotente)', async () => {
      const { service, prisma, walletService } = buildService();
      prisma.walletTransaction.findUnique.mockResolvedValue({
        tournamentEntryId: 'entry-1',
      });
      prisma.tournamentEntry.findUnique.mockResolvedValue({
        id: 'entry-1',
        userId: 'user-1',
        status: 'REGISTERED',
        chipStack: 10_000,
        finalPosition: null,
        prizeAmount: null,
        user: { name: 'Jogador' },
      });

      const result = await service.registerEntry('user-1', 'trn-1', 'idem-1');
      expect(result.id).toBe('entry-1');
      expect(walletService.applyLedgerEntry).not.toHaveBeenCalled();
    });

    it('debita buyIn+fee, cria a inscrição e incrementa o prize pool', async () => {
      const { service, prisma, walletService } = buildService();
      prisma.walletTransaction.findUnique.mockResolvedValue(null);
      prisma.wallet.findUniqueOrThrow.mockResolvedValue(WALLET);
      prisma.tournament.findUnique.mockResolvedValue(TOURNAMENT);
      prisma.tournamentEntry.count.mockResolvedValue(0);
      prisma.tx.tournamentEntry.create.mockResolvedValue({ id: 'entry-1' });
      walletService.applyLedgerEntry.mockResolvedValue({ id: 'wtxn-1' });
      prisma.tx.tournament.updateMany.mockResolvedValue({ count: 1 });
      prisma.tx.tournamentEntry.update.mockResolvedValue({
        id: 'entry-1',
        userId: 'user-1',
        status: 'REGISTERED',
        chipStack: 10_000,
        finalPosition: null,
        prizeAmount: null,
        user: { name: 'Jogador' },
      });

      await service.registerEntry('user-1', 'trn-1', 'idem-1');

      expect(walletService.applyLedgerEntry).toHaveBeenCalledWith(
        prisma.tx,
        WALLET.id,
        expect.objectContaining({
          type: 'TOURNAMENT_BUY_IN',
          amount: expect.objectContaining({ s: -1 }) as unknown, // Decimal negativo (buyIn+fee)
        }),
      );
      expect(prisma.tx.tournament.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            prizePool: { increment: TOURNAMENT.buyIn },
          }),
        }),
      );
    });

    it('mapeia violação de unique (já inscrito) para 409', async () => {
      const { service, prisma } = buildService();
      prisma.walletTransaction.findUnique.mockResolvedValue(null);
      prisma.wallet.findUniqueOrThrow.mockResolvedValue(WALLET);
      prisma.tournament.findUnique.mockResolvedValue(TOURNAMENT);
      prisma.tournamentEntry.count.mockResolvedValue(0);
      (prisma.$transaction as jest.Mock).mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicate', {
          code: 'P2002',
          clientVersion: '6.19.3',
        }),
      );

      await expect(
        service.registerEntry('user-1', 'trn-1', 'idem-1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('eliminateEntry', () => {
    it('lança 404 quando a inscrição não existe', async () => {
      const { service, prisma } = buildService();
      prisma.tournamentEntry.findUnique.mockResolvedValue(null);
      await expect(
        service.eliminateEntry('trn-1', 'entry-1', {}),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejeita eliminar quem já foi eliminado', async () => {
      const { service, prisma } = buildService();
      prisma.tournamentEntry.findUnique.mockResolvedValue({
        id: 'entry-1',
        tournamentId: 'trn-1',
        status: 'ELIMINATED',
      });
      await expect(
        service.eliminateEntry('trn-1', 'entry-1', {}),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('elimina e zera o chipStack', async () => {
      const { service, prisma } = buildService();
      prisma.tournamentEntry.findUnique.mockResolvedValue({
        id: 'entry-1',
        tournamentId: 'trn-1',
        status: 'PLAYING',
      });
      prisma.tournamentEntry.update.mockResolvedValue({
        id: 'entry-1',
        userId: 'user-1',
        status: 'ELIMINATED',
        chipStack: 0,
        finalPosition: 4,
        prizeAmount: null,
        user: { name: 'Jogador' },
      });

      const result = await service.eliminateEntry('trn-1', 'entry-1', {
        finalPosition: 4,
      });

      expect(prisma.tournament.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'RUNNING' } }),
      );
      expect(result.chipStack).toBe(0);
      expect(result.finalPosition).toBe(4);
    });
  });

  describe('finishTournament', () => {
    it('rejeita torneio já finalizado', async () => {
      const { service, prisma } = buildService();
      prisma.tournament.findUnique.mockResolvedValue({
        ...TOURNAMENT,
        status: 'FINISHED',
      });
      await expect(service.finishTournament('trn-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejeita quando restam múltiplas inscrições ativas e há prêmio de 1º lugar', async () => {
      const { service, prisma } = buildService();
      prisma.tournament.findUnique.mockResolvedValue(TOURNAMENT);
      prisma.tournamentPrize.findMany.mockResolvedValue([
        { position: 1, percentage: new Prisma.Decimal('100.00') },
      ]);
      prisma.tournamentEntry.findMany.mockResolvedValue([
        {
          id: 'e1',
          userId: 'u1',
          status: 'PLAYING',
          finalPosition: null,
          payoutTransactionId: null,
        },
        {
          id: 'e2',
          userId: 'u2',
          status: 'PLAYING',
          finalPosition: null,
          payoutTransactionId: null,
        },
      ]);

      await expect(service.finishTournament('trn-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('paga o campeão inferido automaticamente (só 1 sobrou) e finaliza o torneio', async () => {
      const { service, prisma, walletService } = buildService();
      prisma.tournament.findUnique.mockResolvedValueOnce(TOURNAMENT); // status check
      prisma.tournamentPrize.findMany.mockResolvedValue([
        { position: 1, percentage: new Prisma.Decimal('70.00') },
        { position: 2, percentage: new Prisma.Decimal('30.00') },
      ]);
      prisma.tournamentEntry.findMany
        // 1ª chamada real: computar remaining/payouts.
        .mockResolvedValueOnce([
          {
            id: 'e1',
            userId: 'u1',
            status: 'PLAYING',
            finalPosition: null,
            payoutTransactionId: null,
          },
          {
            id: 'e2',
            userId: 'u2',
            status: 'ELIMINATED',
            finalPosition: 2,
            payoutTransactionId: null,
          },
        ])
        // 2ª chamada real: dentro de getTournament() ao final.
        .mockResolvedValueOnce([]);
      prisma.wallet.findUniqueOrThrow.mockImplementation(() =>
        Promise.resolve(WALLET),
      );
      prisma.tx.wallet.findUniqueOrThrow.mockResolvedValue(WALLET);
      walletService.applyLedgerEntry.mockResolvedValue({ id: 'wtxn-payout' });
      // getTournament() ao final:
      prisma.tournament.findUnique.mockResolvedValueOnce({
        ...TOURNAMENT,
        status: 'FINISHED',
        _count: { entries: 2 },
      });

      await service.finishTournament('trn-1');

      // 2 payouts: campeão (e1, inferido) e vice (e2, finalPosition já setado).
      expect(walletService.applyLedgerEntry).toHaveBeenCalledTimes(2);
      expect(prisma.tx.tournamentEntry.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'e1' },
          data: expect.objectContaining({ status: 'PAID', finalPosition: 1 }),
        }),
      );
      expect(prisma.tx.tournament.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'FINISHED' }),
        }),
      );
    });
  });
});
