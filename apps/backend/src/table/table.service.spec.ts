import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma';
import type { PasswordHasherService } from '../common/crypto/password-hasher.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { WalletService } from '../wallet/wallet.service';
import { TableService } from './table.service';

const CLUBE_ID = 'clube-1';

const TABLE = {
  id: 'table-1',
  clubeId: CLUBE_ID,
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

const WALLET = { id: 'wallet-1', userId: 'user-1', clubeId: CLUBE_ID };

function buildPrisma() {
  const tx = {
    table: { create: jest.fn() },
    tableSession: {
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    stackMovement: { create: jest.fn() },
    user: { create: jest.fn() },
    clubeMembership: { create: jest.fn() },
    wallet: { create: jest.fn() },
  };

  return {
    tx,
    table: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    tableSession: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    stackMovement: { create: jest.fn() },
    wallet: { findUniqueOrThrow: jest.fn() },
    walletTransaction: { findUnique: jest.fn() },
    clubeMembership: { findUnique: jest.fn() },
    withClube: jest.fn((_clubeId: string, cb: (t: typeof tx) => unknown) =>
      cb(tx),
    ),
  };
}

function buildService(overrides?: { prisma?: ReturnType<typeof buildPrisma> }) {
  const prisma = overrides?.prisma ?? buildPrisma();

  const walletService = { applyLedgerEntry: jest.fn() };
  const passwordHasher = { hash: jest.fn().mockResolvedValue('hashed') };

  const service = new TableService(
    prisma as unknown as PrismaService,
    walletService as unknown as WalletService,
    passwordHasher as unknown as PasswordHasherService,
  );

  return { service, prisma, walletService, passwordHasher };
}

describe('TableService', () => {
  describe('createTable', () => {
    it('rejeita minBuyIn > maxBuyIn', async () => {
      const { service } = buildService();
      await expect(
        service.createTable('admin-1', CLUBE_ID, {
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

    it('cria a mesa (via withClube) com occupiedSeats 0', async () => {
      const { service, prisma } = buildService();
      prisma.tx.table.create.mockResolvedValue(TABLE);

      const result = await service.createTable('admin-1', CLUBE_ID, {
        name: 'Mesa',
        type: 'CASH_GAME',
        smallBlind: '1.00',
        bigBlind: '2.00',
        minBuyIn: '40.00',
        maxBuyIn: '200.00',
        maxSeats: 6,
      } as never);

      expect(prisma.withClube).toHaveBeenCalledWith(
        CLUBE_ID,
        expect.any(Function),
      );
      expect(result.occupiedSeats).toBe(0);
      expect(result.maxSeats).toBe(6);
    });
  });

  describe('getTable', () => {
    it('lança 404 se a mesa não existe', async () => {
      const { service, prisma } = buildService();
      prisma.table.findUnique.mockResolvedValue(null);
      await expect(
        service.getTable(CLUBE_ID, 'inexistente'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lança 404 se a mesa é de outro clube', async () => {
      const { service, prisma } = buildService();
      prisma.table.findUnique.mockResolvedValue({
        ...TABLE,
        clubeId: 'outro-clube',
      });
      await expect(
        service.getTable(CLUBE_ID, 'table-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('retorna o status atual da mesa (ex: CLOSED, pra tela de detalhes esconder "Fechar mesa")', async () => {
      const { service, prisma } = buildService();
      prisma.table.findUnique.mockResolvedValue({
        ...TABLE,
        status: 'CLOSED',
        _count: { sessions: 0 },
      });

      const result = await service.getTable(CLUBE_ID, 'table-1');

      expect(result.status).toBe('CLOSED');
    });
  });

  describe('getSeats', () => {
    it('lança 404 se a mesa não existe', async () => {
      const { service, prisma } = buildService();
      prisma.table.findUnique.mockResolvedValue(null);
      await expect(
        service.getSeats(CLUBE_ID, 'inexistente'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lança 404 se a mesa é de outro clube', async () => {
      const { service, prisma } = buildService();
      prisma.table.findUnique.mockResolvedValue({
        ...TABLE,
        clubeId: 'outro-clube',
      });
      await expect(
        service.getSeats(CLUBE_ID, 'table-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
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

      const seats = await service.getSeats(CLUBE_ID, 'table-1');

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
          CLUBE_ID,
          'table-1',
          { seatNumber: 1, buyInAmount: '50.00' },
          'idem-1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejeita mesa de outro clube (404)', async () => {
      const { service, prisma } = buildService();
      prisma.table.findUnique.mockResolvedValue({
        ...TABLE,
        clubeId: 'outro-clube',
      });

      await expect(
        service.sitAtTable(
          'user-1',
          CLUBE_ID,
          'table-1',
          { seatNumber: 1, buyInAmount: '50.00' },
          'idem-1',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejeita buy-in fora da faixa da mesa', async () => {
      const { service, prisma } = buildService();
      prisma.table.findUnique.mockResolvedValue(TABLE);
      prisma.walletTransaction.findUnique.mockResolvedValue(null);

      await expect(
        service.sitAtTable(
          'user-1',
          CLUBE_ID,
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
        CLUBE_ID,
        'table-1',
        { seatNumber: 1, buyInAmount: '50.00' },
        'idem-1',
      );

      expect(prisma.wallet.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { userId_clubeId: { userId: 'user-1', clubeId: CLUBE_ID } },
      });
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
      (prisma.withClube as jest.Mock).mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicate', {
          code: 'P2002',
          clientVersion: '6.19.3',
        }),
      );

      await expect(
        service.sitAtTable(
          'user-1',
          CLUBE_ID,
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
        clubeId: CLUBE_ID,
        userId: 'outro-usuario',
        status: 'ACTIVE',
        seatNumber: 1,
        currentStack: new Prisma.Decimal('80.00'),
        version: 0,
        user: { id: 'outro-usuario', name: 'Outro' },
      });

      await expect(
        service.cashOut('user-1', CLUBE_ID, 'table-1', 'session-1', 'idem-2'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejeita sessão de outro clube (404)', async () => {
      const { service, prisma } = buildService();
      prisma.tableSession.findUnique.mockResolvedValue({
        id: 'session-1',
        tableId: 'table-1',
        clubeId: 'outro-clube',
        userId: 'user-1',
        status: 'ACTIVE',
        seatNumber: 1,
        currentStack: new Prisma.Decimal('80.00'),
        version: 0,
        user: { id: 'user-1', name: 'Jogador' },
      });

      await expect(
        service.cashOut('user-1', CLUBE_ID, 'table-1', 'session-1', 'idem-2'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('debita o stack inteiro, credita a wallet e libera o assento', async () => {
      const { service, prisma, walletService } = buildService();
      prisma.walletTransaction.findUnique.mockResolvedValue(null);
      prisma.wallet.findUniqueOrThrow.mockResolvedValue(WALLET);
      prisma.tableSession.findUnique.mockResolvedValue({
        id: 'session-1',
        tableId: 'table-1',
        clubeId: CLUBE_ID,
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
        CLUBE_ID,
        'table-1',
        'session-1',
        'idem-2',
      );

      expect(prisma.wallet.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { userId_clubeId: { userId: 'user-1', clubeId: CLUBE_ID } },
      });
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

  describe('rebuy', () => {
    it('rejeita mesa de outro clube (404)', async () => {
      const { service, prisma } = buildService();
      prisma.table.findUnique.mockResolvedValue({
        ...TABLE,
        clubeId: 'outro-clube',
      });

      await expect(
        service.rebuy(
          'admin-1',
          CLUBE_ID,
          'table-1',
          'session-1',
          { buyInAmount: '50.00' },
          'idem-3',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejeita buy-in fora da faixa da mesa', async () => {
      const { service, prisma } = buildService();
      prisma.table.findUnique.mockResolvedValue(TABLE);

      await expect(
        service.rebuy(
          'admin-1',
          CLUBE_ID,
          'table-1',
          'session-1',
          { buyInAmount: '5.00' },
          'idem-3',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejeita sessão já encerrada', async () => {
      const { service, prisma } = buildService();
      prisma.table.findUnique.mockResolvedValue(TABLE);
      prisma.walletTransaction.findUnique.mockResolvedValue(null);
      prisma.tableSession.findUnique.mockResolvedValue({
        id: 'session-1',
        tableId: 'table-1',
        clubeId: CLUBE_ID,
        userId: 'user-1',
        status: 'CASHED_OUT',
        seatNumber: 3,
        currentStack: new Prisma.Decimal('0'),
        version: 1,
        user: { id: 'user-1', name: 'Jogador' },
      });

      await expect(
        service.rebuy(
          'admin-1',
          CLUBE_ID,
          'table-1',
          'session-1',
          { buyInAmount: '50.00' },
          'idem-3',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('debita a wallet, soma ao stack/totalBuyIn existentes e registra o StackMovement de BUY_IN', async () => {
      const { service, prisma, walletService } = buildService();
      prisma.table.findUnique.mockResolvedValue(TABLE);
      prisma.walletTransaction.findUnique.mockResolvedValue(null);
      prisma.wallet.findUniqueOrThrow.mockResolvedValue(WALLET);
      prisma.tableSession.findUnique.mockResolvedValue({
        id: 'session-1',
        tableId: 'table-1',
        clubeId: CLUBE_ID,
        userId: 'user-1',
        status: 'ACTIVE',
        seatNumber: 3,
        currentStack: new Prisma.Decimal('0'),
        version: 2,
        user: { id: 'user-1', name: 'Jogador' },
      });
      walletService.applyLedgerEntry.mockResolvedValue({ id: 'wtxn-4' });
      prisma.tx.tableSession.updateMany.mockResolvedValue({ count: 1 });

      const seat = await service.rebuy(
        'admin-1',
        CLUBE_ID,
        'table-1',
        'session-1',
        { buyInAmount: '50.00' },
        'idem-3',
      );

      expect(walletService.applyLedgerEntry).toHaveBeenCalledWith(
        prisma.tx,
        WALLET.id,
        expect.objectContaining({ type: 'TABLE_BUY_IN' }),
      );
      expect(prisma.tx.tableSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'session-1', version: 2 },
          data: expect.objectContaining({
            totalBuyIn: { increment: expect.anything() as unknown },
            version: { increment: 1 },
          }) as unknown,
        }),
      );
      expect(prisma.tx.stackMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            reason: 'BUY_IN',
            walletTransactionId: 'wtxn-4',
            createdById: 'admin-1',
          }),
        }),
      );
      expect(seat).toMatchObject({ seatNumber: 3, currentStack: '50.00' });
    });

    it('tenta de novo quando perde o optimistic lock (version mudou)', async () => {
      const { service, prisma, walletService } = buildService();
      prisma.table.findUnique.mockResolvedValue(TABLE);
      prisma.walletTransaction.findUnique.mockResolvedValue(null);
      prisma.wallet.findUniqueOrThrow.mockResolvedValue(WALLET);
      prisma.tableSession.findUnique.mockResolvedValue({
        id: 'session-1',
        tableId: 'table-1',
        clubeId: CLUBE_ID,
        userId: 'user-1',
        status: 'ACTIVE',
        seatNumber: 3,
        currentStack: new Prisma.Decimal('0'),
        version: 2,
        user: { id: 'user-1', name: 'Jogador' },
      });
      walletService.applyLedgerEntry.mockResolvedValue({ id: 'wtxn-5' });
      prisma.tx.tableSession.updateMany
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 1 });

      const seat = await service.rebuy(
        'admin-1',
        CLUBE_ID,
        'table-1',
        'session-1',
        { buyInAmount: '50.00' },
        'idem-3',
      );

      expect(prisma.tx.tableSession.updateMany).toHaveBeenCalledTimes(2);
      expect(seat).toMatchObject({ seatNumber: 3, currentStack: '50.00' });
    });

    it('idempotente: transação já registrada não debita a wallet de novo', async () => {
      const { service, prisma, walletService } = buildService();
      prisma.table.findUnique.mockResolvedValue(TABLE);
      prisma.walletTransaction.findUnique.mockResolvedValue({
        id: 'wtxn-existente',
      });
      prisma.tableSession.findUnique.mockResolvedValue({
        id: 'session-1',
        tableId: 'table-1',
        clubeId: CLUBE_ID,
        userId: 'user-1',
        status: 'ACTIVE',
        seatNumber: 3,
        currentStack: new Prisma.Decimal('50.00'),
        version: 3,
        user: { id: 'user-1', name: 'Jogador' },
      });

      const seat = await service.rebuy(
        'admin-1',
        CLUBE_ID,
        'table-1',
        'session-1',
        { buyInAmount: '50.00' },
        'idem-3',
      );

      expect(walletService.applyLedgerEntry).not.toHaveBeenCalled();
      expect(seat).toMatchObject({ seatNumber: 3, currentStack: '50.00' });
    });
  });

  describe('closeTable', () => {
    it('faz cash-out de todas as sessões ativas, marca a mesa como CLOSED e devolve o relatório', async () => {
      const { service, prisma, walletService } = buildService();
      prisma.table.findUnique.mockResolvedValue({ ...TABLE, status: 'OPEN' });
      prisma.tableSession.findMany
        // pré-loop: sessões ACTIVE a fechar
        .mockResolvedValueOnce([{ id: 'session-1' }])
        // pós-loop: todas as sessões da mesa, pro relatório
        .mockResolvedValueOnce([
          {
            userId: 'user-1',
            totalBuyIn: new Prisma.Decimal('80.00'),
            totalCashOut: new Prisma.Decimal('80.00'),
            currentStack: new Prisma.Decimal('0'),
            user: { id: 'user-1', name: 'Jogador' },
          },
        ]);
      prisma.walletTransaction.findUnique.mockResolvedValue(null);
      prisma.wallet.findUniqueOrThrow.mockResolvedValue(WALLET);
      prisma.tableSession.findUnique.mockResolvedValue({
        id: 'session-1',
        tableId: 'table-1',
        clubeId: CLUBE_ID,
        userId: 'user-1',
        status: 'ACTIVE',
        seatNumber: 3,
        currentStack: new Prisma.Decimal('80.00'),
        version: 0,
        user: { id: 'user-1', name: 'Jogador' },
      });
      walletService.applyLedgerEntry.mockResolvedValue({ id: 'wtxn-3' });
      prisma.tx.tableSession.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.closeTable(CLUBE_ID, 'table-1');

      expect(prisma.tableSession.findMany).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: { tableId: 'table-1', status: 'ACTIVE' },
        }),
      );
      expect(prisma.tableSession.findMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ where: { tableId: 'table-1' } }),
      );
      expect(walletService.applyLedgerEntry).toHaveBeenCalledWith(
        prisma.tx,
        WALLET.id,
        expect.objectContaining({ type: 'TABLE_CASH_OUT' }),
      );
      expect(prisma.table.update).toHaveBeenCalledWith({
        where: { id: 'table-1' },
        data: { status: 'CLOSED' },
      });
      expect(result.table.status).toBe('CLOSED');
      expect(result.players).toEqual([
        {
          userId: 'user-1',
          userName: 'Jogador',
          totalBuyIn: '80.00',
          totalCashOut: '80.00',
          currentStack: '0.00',
          netResult: '0.00',
        },
      ]);
    });

    it('agrega sessões repetidas do MESMO jogador (rebuy) numa única linha do relatório', async () => {
      const { service, prisma } = buildService();
      prisma.table.findUnique.mockResolvedValue({ ...TABLE, status: 'CLOSED' });
      prisma.tableSession.findMany.mockResolvedValue([
        {
          userId: 'user-1',
          totalBuyIn: new Prisma.Decimal('50.00'),
          totalCashOut: new Prisma.Decimal('20.00'),
          currentStack: new Prisma.Decimal('0'),
          user: { id: 'user-1', name: 'Jogador' },
        },
        {
          userId: 'user-1',
          totalBuyIn: new Prisma.Decimal('30.00'),
          totalCashOut: new Prisma.Decimal('40.00'),
          currentStack: new Prisma.Decimal('0'),
          user: { id: 'user-1', name: 'Jogador' },
        },
      ]);

      const result = await service.closeTable(CLUBE_ID, 'table-1');

      expect(result.players).toEqual([
        {
          userId: 'user-1',
          userName: 'Jogador',
          totalBuyIn: '80.00',
          totalCashOut: '60.00',
          currentStack: '0.00',
          netResult: '-20.00',
        },
      ]);
    });

    it('mesa fechada sem ninguém ter sentado devolve relatório vazio', async () => {
      const { service, prisma } = buildService();
      prisma.table.findUnique.mockResolvedValue({ ...TABLE, status: 'CLOSED' });
      prisma.tableSession.findMany.mockResolvedValue([]);

      const result = await service.closeTable(CLUBE_ID, 'table-1');

      expect(result.players).toEqual([]);
    });

    it('lança 404 se a mesa é de outro clube', async () => {
      const { service, prisma } = buildService();
      prisma.table.findUnique.mockResolvedValue({
        ...TABLE,
        clubeId: 'outro-clube',
      });

      await expect(
        service.closeTable(CLUBE_ID, 'table-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('é idempotente: mesa já fechada não refaz cash-out (mas ainda monta o relatório)', async () => {
      const { service, prisma, walletService } = buildService();
      prisma.table.findUnique.mockResolvedValue({
        ...TABLE,
        status: 'CLOSED',
      });
      prisma.tableSession.findMany.mockResolvedValue([]);

      const result = await service.closeTable(CLUBE_ID, 'table-1');

      expect(prisma.tableSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tableId: 'table-1' } }),
      );
      expect(walletService.applyLedgerEntry).not.toHaveBeenCalled();
      expect(prisma.table.update).not.toHaveBeenCalled();
      expect(result.table.status).toBe('CLOSED');
    });
  });

  describe('reopenTable', () => {
    it('volta o status de CLOSED para OPEN', async () => {
      const { service, prisma } = buildService();
      prisma.table.findUnique.mockResolvedValue({
        ...TABLE,
        status: 'CLOSED',
        _count: { sessions: 0 },
      });
      prisma.table.update.mockResolvedValue({
        ...TABLE,
        status: 'OPEN',
        _count: { sessions: 0 },
      });

      const result = await service.reopenTable(CLUBE_ID, 'table-1');

      expect(prisma.table.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'table-1' },
          data: { status: 'OPEN' },
        }),
      );
      expect(result.status).toBe('OPEN');
    });

    it('é idempotente: mesa já aberta não chama update', async () => {
      const { service, prisma } = buildService();
      prisma.table.findUnique.mockResolvedValue({
        ...TABLE,
        status: 'OPEN',
        _count: { sessions: 0 },
      });

      const result = await service.reopenTable(CLUBE_ID, 'table-1');

      expect(prisma.table.update).not.toHaveBeenCalled();
      expect(result.status).toBe('OPEN');
    });

    it('lança 404 se a mesa é de outro clube', async () => {
      const { service, prisma } = buildService();
      prisma.table.findUnique.mockResolvedValue({
        ...TABLE,
        status: 'CLOSED',
        clubeId: 'outro-clube',
      });

      await expect(
        service.reopenTable(CLUBE_ID, 'table-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('sitAtTableForUser', () => {
    it('rejeita usuário sem vínculo ACTIVE neste clube (404), sem tocar a wallet', async () => {
      const { service, prisma, walletService } = buildService();
      prisma.clubeMembership.findUnique.mockResolvedValue(null);

      await expect(
        service.sitAtTableForUser(
          CLUBE_ID,
          'table-1',
          'outro-usuario',
          { seatNumber: 1, buyInAmount: '50.00' },
          'idem-1',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.wallet.findUniqueOrThrow).not.toHaveBeenCalled();
      expect(walletService.applyLedgerEntry).not.toHaveBeenCalled();
    });

    it('rejeita vínculo REVOKED neste clube (404)', async () => {
      const { service, prisma } = buildService();
      prisma.clubeMembership.findUnique.mockResolvedValue({
        status: 'REVOKED',
      });

      await expect(
        service.sitAtTableForUser(
          CLUBE_ID,
          'table-1',
          'ex-membro',
          { seatNumber: 1, buyInAmount: '50.00' },
          'idem-1',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('membro ACTIVE: delega pro mesmo sitAtTable, debitando a wallet DELE', async () => {
      const { service, prisma, walletService } = buildService();
      prisma.clubeMembership.findUnique.mockResolvedValue({
        status: 'ACTIVE',
      });
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

      const seat = await service.sitAtTableForUser(
        CLUBE_ID,
        'table-1',
        'user-1',
        { seatNumber: 1, buyInAmount: '50.00' },
        'idem-1',
      );

      expect(prisma.clubeMembership.findUnique).toHaveBeenCalledWith({
        where: { clubeId_userId: { clubeId: CLUBE_ID, userId: 'user-1' } },
        select: { status: true },
      });
      expect(prisma.wallet.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { userId_clubeId: { userId: 'user-1', clubeId: CLUBE_ID } },
      });
      expect(seat).toMatchObject({ userId: 'user-1', currentStack: '50.00' });
    });
  });

  describe('sitGuestAtTable', () => {
    const GUEST_DTO = {
      seatNumber: 1,
      buyInAmount: '50.00',
      name: 'Convidado da Silva',
      phone: '11999998888',
    };

    it('cria User/Membership/Wallet do convidado, credita ADJUSTMENT e debita TABLE_BUY_IN', async () => {
      const { service, prisma, walletService, passwordHasher } = buildService();
      prisma.table.findUnique.mockResolvedValue(TABLE);
      prisma.walletTransaction.findUnique.mockResolvedValue(null);
      prisma.tx.user.create.mockResolvedValue({ id: 'guest-1' });
      prisma.tx.wallet.create.mockResolvedValue({ id: 'wallet-guest-1' });
      prisma.tx.tableSession.create.mockResolvedValue({ id: 'session-1' });
      walletService.applyLedgerEntry
        .mockResolvedValueOnce({ id: 'wtxn-adjustment' }) // crédito em espécie
        .mockResolvedValueOnce({ id: 'wtxn-buyin' }); // débito do buy-in
      prisma.tx.tableSession.update.mockResolvedValue({
        seatNumber: 1,
        currentStack: new Prisma.Decimal('50.00'),
        user: { id: 'guest-1', name: 'Convidado da Silva' },
      });

      const seat = await service.sitGuestAtTable(
        'admin-1',
        CLUBE_ID,
        'table-1',
        GUEST_DTO,
        'idem-guest-1',
      );

      expect(passwordHasher.hash).toHaveBeenCalled();
      expect(prisma.tx.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Convidado da Silva',
            phone: '11999998888',
            isGuest: true,
          }),
        }),
      );
      expect(prisma.tx.clubeMembership.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            clubeId: CLUBE_ID,
            userId: 'guest-1',
            role: 'PLAYER',
            status: 'ACTIVE',
          }),
        }),
      );
      expect(walletService.applyLedgerEntry).toHaveBeenNthCalledWith(
        1,
        prisma.tx,
        'wallet-guest-1',
        expect.objectContaining({ type: 'ADJUSTMENT', createdById: 'admin-1' }),
      );
      expect(walletService.applyLedgerEntry).toHaveBeenNthCalledWith(
        2,
        prisma.tx,
        'wallet-guest-1',
        expect.objectContaining({
          type: 'TABLE_BUY_IN',
          tableSessionId: 'session-1',
        }),
      );
      expect(prisma.tx.stackMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            reason: 'BUY_IN',
            walletTransactionId: 'wtxn-buyin',
            createdById: 'admin-1',
          }),
        }),
      );
      expect(seat).toMatchObject({ userId: 'guest-1', currentStack: '50.00' });
    });

    it('replay pela mesma idempotency key não cria um segundo convidado', async () => {
      const { service, prisma } = buildService();
      prisma.table.findUnique.mockResolvedValue(TABLE);
      prisma.walletTransaction.findUnique.mockResolvedValue({
        tableSessionId: 'session-1',
      });
      prisma.tableSession.findUnique.mockResolvedValue({
        id: 'session-1',
        clubeId: CLUBE_ID,
        seatNumber: 1,
        currentStack: new Prisma.Decimal('50.00'),
        user: { id: 'guest-1', name: 'Convidado da Silva' },
      });

      const seat = await service.sitGuestAtTable(
        'admin-1',
        CLUBE_ID,
        'table-1',
        GUEST_DTO,
        'idem-guest-1',
      );

      expect(prisma.tx.user.create).not.toHaveBeenCalled();
      expect(seat).toMatchObject({ userId: 'guest-1' });
    });

    it('assento já ocupado (P2002) não deixa convidado órfão — nada commita', async () => {
      const { service, prisma } = buildService();
      prisma.table.findUnique.mockResolvedValue(TABLE);
      prisma.walletTransaction.findUnique.mockResolvedValue(null);
      (prisma.withClube as jest.Mock).mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicate', {
          code: 'P2002',
          clientVersion: '6.19.3',
        }),
      );

      await expect(
        service.sitGuestAtTable(
          'admin-1',
          CLUBE_ID,
          'table-1',
          GUEST_DTO,
          'idem-guest-2',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('cashOutAsAdmin', () => {
    it('faz cash-out da sessão de OUTRO usuário sem checar dono, registrando createdById', async () => {
      const { service, prisma, walletService } = buildService();
      prisma.walletTransaction.findUnique.mockResolvedValue(null);
      prisma.wallet.findUniqueOrThrow.mockResolvedValue(WALLET);
      prisma.tableSession.findUnique.mockResolvedValue({
        id: 'session-1',
        tableId: 'table-1',
        clubeId: CLUBE_ID,
        userId: 'guest-1',
        status: 'ACTIVE',
        seatNumber: 3,
        currentStack: new Prisma.Decimal('80.00'),
        version: 0,
        user: { id: 'guest-1', name: 'Convidado' },
      });
      walletService.applyLedgerEntry.mockResolvedValue({ id: 'wtxn-4' });
      prisma.tx.tableSession.updateMany.mockResolvedValue({ count: 1 });

      const seat = await service.cashOutAsAdmin(
        'admin-1',
        CLUBE_ID,
        'table-1',
        'session-1',
        'idem-3',
      );

      expect(prisma.tx.stackMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ createdById: 'admin-1' }),
        }),
      );
      expect(seat.sessionId).toBeNull();
    });
  });

  describe('recordMovement', () => {
    it('rejeita ajuste que deixaria o stack negativo', async () => {
      const { service, prisma } = buildService();
      prisma.tableSession.findUnique.mockResolvedValue({
        id: 'session-1',
        tableId: 'table-1',
        clubeId: CLUBE_ID,
        userId: 'user-1',
        status: 'ACTIVE',
        seatNumber: 1,
        currentStack: new Prisma.Decimal('10.00'),
        version: 0,
        user: { id: 'user-1', name: 'Jogador' },
      });

      await expect(
        service.recordMovement('admin-1', CLUBE_ID, 'table-1', 'session-1', {
          amount: '-50.00',
          reason: 'HAND_RESULT',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('lança 404 se a sessão é de outro clube', async () => {
      const { service, prisma } = buildService();
      prisma.tableSession.findUnique.mockResolvedValue({
        id: 'session-1',
        tableId: 'table-1',
        clubeId: 'outro-clube',
        userId: 'user-1',
        status: 'ACTIVE',
        seatNumber: 1,
        currentStack: new Prisma.Decimal('10.00'),
        version: 0,
        user: { id: 'user-1', name: 'Jogador' },
      });

      await expect(
        service.recordMovement('admin-1', CLUBE_ID, 'table-1', 'session-1', {
          amount: '20.00',
          reason: 'HAND_RESULT',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('aplica o ajuste e registra o StackMovement sem tocar a wallet', async () => {
      const { service, prisma, walletService } = buildService();
      prisma.tableSession.findUnique.mockResolvedValue({
        id: 'session-1',
        tableId: 'table-1',
        clubeId: CLUBE_ID,
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
        CLUBE_ID,
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
