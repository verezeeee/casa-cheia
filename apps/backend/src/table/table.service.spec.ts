import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { WalletService } from '../wallet/wallet.service';
import { TableService } from './table.service';

const TABLE = {
  id: 'table-1',
  name: 'NL Holdem 1/2',
  type: 'CASH_GAME',
  smallBlind: new Prisma.Decimal('1.00'),
  bigBlind: new Prisma.Decimal('2.00'),
  minBuyIn: new Prisma.Decimal('40.00'),
  maxBuyIn: new Prisma.Decimal('200.00'),
  maxSeats: 6,
  status: 'OPEN',
  rakePercent: null,
  createdById: 'admin-1',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

const WALLET = { id: 'wallet-1', userId: 'user-1' };

function buildPrisma() {
  const tx = {
    tableSession: {
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    stackMovement: { create: jest.fn() },
  };

  return {
    tx,
    table: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
    tableSession: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    stackMovement: { create: jest.fn() },
    wallet: { findUniqueOrThrow: jest.fn() },
    walletTransaction: { findUnique: jest.fn() },
    $transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
  };
}

function buildService(overrides?: { prisma?: ReturnType<typeof buildPrisma> }) {
  const prisma = overrides?.prisma ?? buildPrisma();

  const walletService = { applyLedgerEntry: jest.fn() };

  const service = new TableService(
    prisma as unknown as PrismaService,
    walletService as unknown as WalletService,
  );

  return { service, prisma, walletService };
}

describe('TableService', () => {
  describe('createTable', () => {
    it('rejeita minBuyIn > maxBuyIn', async () => {
      const { service } = buildService();
      await expect(
        service.createTable('admin-1', {
          name: 'Mesa',
          type: 'CASH_GAME',
          smallBlind: '1.00',
          bigBlind: '2.00',
          minBuyIn: '300.00',
          maxBuyIn: '200.00',
          maxSeats: 6,
        } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('cria a mesa com occupiedSeats 0', async () => {
      const { service, prisma } = buildService();
      prisma.table.create.mockResolvedValue(TABLE);

      const result = await service.createTable('admin-1', {
        name: 'Mesa',
        type: 'CASH_GAME',
        smallBlind: '1.00',
        bigBlind: '2.00',
        minBuyIn: '40.00',
        maxBuyIn: '200.00',
        maxSeats: 6,
      } as never);

      expect(result.occupiedSeats).toBe(0);
      expect(result.maxSeats).toBe(6);
    });
  });

  describe('getSeats', () => {
    it('lança 404 se a mesa não existe', async () => {
      const { service, prisma } = buildService();
      prisma.table.findUnique.mockResolvedValue(null);
      await expect(service.getSeats('inexistente')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('monta a grade completa (ocupados + vagos)', async () => {
      const { service, prisma } = buildService();
      prisma.table.findUnique.mockResolvedValue(TABLE);
      prisma.tableSession.findMany.mockResolvedValue([
        {
          seatNumber: 2,
          currentStack: new Prisma.Decimal('100.00'),
          user: { id: 'user-1', name: 'Jogador' },
        },
      ]);

      const seats = await service.getSeats('table-1');

      expect(seats).toHaveLength(6);
      expect(seats[1]).toMatchObject({
        seatNumber: 2,
        userId: 'user-1',
        currentStack: '100.00',
      });
      expect(seats[0]).toMatchObject({
        seatNumber: 1,
        userId: null,
        currentStack: null,
      });
    });
  });

  describe('sitAtTable', () => {
    it('rejeita mesa fechada', async () => {
      const { service, prisma } = buildService();
      prisma.table.findUnique.mockResolvedValue({ ...TABLE, status: 'CLOSED' });

      await expect(
        service.sitAtTable(
          'user-1',
          'table-1',
          { seatNumber: 1, buyInAmount: '50.00' },
          'idem-1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejeita buy-in fora da faixa da mesa', async () => {
      const { service, prisma } = buildService();
      prisma.table.findUnique.mockResolvedValue(TABLE);
      prisma.walletTransaction.findUnique.mockResolvedValue(null);

      await expect(
        service.sitAtTable(
          'user-1',
          'table-1',
          { seatNumber: 1, buyInAmount: '5.00' },
          'idem-1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('cria a sessão, debita a wallet e cria o StackMovement de BUY_IN', async () => {
      const { service, prisma, walletService } = buildService();
      prisma.table.findUnique.mockResolvedValue(TABLE);
      prisma.walletTransaction.findUnique.mockResolvedValue(null);
      prisma.wallet.findUniqueOrThrow.mockResolvedValue(WALLET);
      prisma.tx.tableSession.create.mockResolvedValue({ id: 'session-1' });
      walletService.applyLedgerEntry.mockResolvedValue({ id: 'wtxn-1' });
      prisma.tx.tableSession.update.mockResolvedValue({
        seatNumber: 1,
        currentStack: new Prisma.Decimal('50.00'),
        user: { id: 'user-1', name: 'Jogador' },
      });

      const seat = await service.sitAtTable(
        'user-1',
        'table-1',
        { seatNumber: 1, buyInAmount: '50.00' },
        'idem-1',
      );

      expect(walletService.applyLedgerEntry).toHaveBeenCalledWith(
        prisma.tx,
        WALLET.id,
        expect.objectContaining({
          type: 'TABLE_BUY_IN',
          tableSessionId: 'session-1',
        }),
      );
      expect(prisma.tx.stackMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            reason: 'BUY_IN',
            walletTransactionId: 'wtxn-1',
          }),
        }),
      );
      expect(seat).toMatchObject({
        seatNumber: 1,
        userId: 'user-1',
        currentStack: '50.00',
      });
    });

    it('mapeia violação de índice único para 409 (assento/usuário já ativo)', async () => {
      const { service, prisma } = buildService();
      prisma.table.findUnique.mockResolvedValue(TABLE);
      prisma.walletTransaction.findUnique.mockResolvedValue(null);
      prisma.wallet.findUniqueOrThrow.mockResolvedValue(WALLET);
      (prisma.$transaction as jest.Mock).mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicate', {
          code: 'P2002',
          clientVersion: '6.19.3',
        }),
      );

      await expect(
        service.sitAtTable(
          'user-1',
          'table-1',
          { seatNumber: 1, buyInAmount: '50.00' },
          'idem-1',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('cashOut', () => {
    it('rejeita cash-out de sessão de outro usuário', async () => {
      const { service, prisma } = buildService();
      prisma.walletTransaction.findUnique.mockResolvedValue(null);
      prisma.wallet.findUniqueOrThrow.mockResolvedValue(WALLET);
      prisma.tableSession.findUnique.mockResolvedValue({
        id: 'session-1',
        tableId: 'table-1',
        userId: 'outro-usuario',
        status: 'ACTIVE',
        seatNumber: 1,
        currentStack: new Prisma.Decimal('80.00'),
        version: 0,
        user: { id: 'outro-usuario', name: 'Outro' },
      });

      await expect(
        service.cashOut('user-1', 'table-1', 'session-1', 'idem-2'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('debita o stack inteiro, credita a wallet e libera o assento', async () => {
      const { service, prisma, walletService } = buildService();
      prisma.walletTransaction.findUnique.mockResolvedValue(null);
      prisma.wallet.findUniqueOrThrow.mockResolvedValue(WALLET);
      prisma.tableSession.findUnique.mockResolvedValue({
        id: 'session-1',
        tableId: 'table-1',
        userId: 'user-1',
        status: 'ACTIVE',
        seatNumber: 3,
        currentStack: new Prisma.Decimal('80.00'),
        version: 0,
        user: { id: 'user-1', name: 'Jogador' },
      });
      walletService.applyLedgerEntry.mockResolvedValue({ id: 'wtxn-2' });
      prisma.tx.tableSession.updateMany.mockResolvedValue({ count: 1 });

      const seat = await service.cashOut(
        'user-1',
        'table-1',
        'session-1',
        'idem-2',
      );

      expect(walletService.applyLedgerEntry).toHaveBeenCalledWith(
        prisma.tx,
        WALLET.id,
        expect.objectContaining({ type: 'TABLE_CASH_OUT' }),
      );
      expect(seat).toEqual({
        seatNumber: 3,
        userId: null,
        userName: null,
        currentStack: null,
        sessionId: null,
      });
    });
  });

  describe('recordMovement', () => {
    it('rejeita ajuste que deixaria o stack negativo', async () => {
      const { service, prisma } = buildService();
      prisma.tableSession.findUnique.mockResolvedValue({
        id: 'session-1',
        tableId: 'table-1',
        userId: 'user-1',
        status: 'ACTIVE',
        seatNumber: 1,
        currentStack: new Prisma.Decimal('10.00'),
        version: 0,
        user: { id: 'user-1', name: 'Jogador' },
      });

      await expect(
        service.recordMovement('admin-1', 'table-1', 'session-1', {
          amount: '-50.00',
          reason: 'HAND_RESULT',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('aplica o ajuste e registra o StackMovement sem tocar a wallet', async () => {
      const { service, prisma, walletService } = buildService();
      prisma.tableSession.findUnique.mockResolvedValue({
        id: 'session-1',
        tableId: 'table-1',
        userId: 'user-1',
        status: 'ACTIVE',
        seatNumber: 1,
        currentStack: new Prisma.Decimal('50.00'),
        version: 2,
        user: { id: 'user-1', name: 'Jogador' },
      });
      prisma.tableSession.updateMany.mockResolvedValue({ count: 1 });

      const seat = await service.recordMovement(
        'admin-1',
        'table-1',
        'session-1',
        {
          amount: '20.00',
          reason: 'HAND_RESULT',
        },
      );

      expect(seat.currentStack).toBe('70.00');
      expect(prisma.stackMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            reason: 'HAND_RESULT',
            createdById: 'admin-1',
          }),
        }),
      );
      expect(walletService.applyLedgerEntry).not.toHaveBeenCalled();
    });
  });
});
