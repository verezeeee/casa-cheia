import {
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Prisma, type Wallet } from '../generated/prisma';
import type { PrismaService } from '../prisma/prisma.service';
import { WalletService } from './wallet.service';

const WALLET: Wallet = {
  id: 'wallet-1',
  userId: 'user-1',
  clubeId: 'clube-1',
  balance: new Prisma.Decimal('100.00'),
  version: 3,
  blockedAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

/**
 * `paymentsEnabled: true` por padrão nos testes — o oposto do default de
 * produção (`false`, standby) — porque é sob enforcement total que a
 * "saldo insuficiente" e as demais regras financeiras existem para ser
 * testadas. Os casos de standby (`describe('pagamentos em standby')`)
 * sobrescrevem isso explicitamente via `buildService({ paymentsEnabled: false })`.
 */
const WALLET_CONFIG = {
  minDeposit: '10.00',
  maxDeposit: '5000.00',
  minWithdrawal: '10.00',
  paymentsEnabled: true,
};

/** Fake mínimo de `PrismaService`, com o `tx` interativo compartilhado entre chamadas. */
function buildPrisma() {
  const tx = {
    $queryRaw: jest.fn(),
    walletTransaction: { create: jest.fn() },
    wallet: { update: jest.fn() },
  };

  return {
    tx,
    wallet: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    walletTransaction: { findMany: jest.fn(), findUnique: jest.fn() },
    $transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
  };
}

function buildService(overrides?: {
  prisma?: ReturnType<typeof buildPrisma>;
  paymentsEnabled?: boolean;
}) {
  const prisma = overrides?.prisma ?? buildPrisma();

  const configGet = jest.fn((key: string) => {
    if (key === 'wallet') {
      return {
        ...WALLET_CONFIG,
        paymentsEnabled:
          overrides?.paymentsEnabled ?? WALLET_CONFIG.paymentsEnabled,
      };
    }
    return undefined;
  });
  const configService = { get: configGet };

  const service = new WalletService(
    prisma as unknown as PrismaService,
    configService as unknown as ConfigService,
  );

  return { service, prisma, configService };
}

/** Simula o resultado de `SELECT ... FOR UPDATE` (lock pessimista da wallet). */
function mockLockedWallet(
  prisma: ReturnType<typeof buildPrisma>,
  balance: string,
) {
  prisma.tx.$queryRaw.mockResolvedValue([
    { id: WALLET.id, balance: new Prisma.Decimal(balance) },
  ]);
}

describe('WalletService', () => {
  describe('getBalance', () => {
    it('devolve o saldo e a versão da carteira', async () => {
      const { service, prisma } = buildService();
      prisma.wallet.findUnique.mockResolvedValue(WALLET);

      await expect(
        service.getBalance(WALLET.userId, WALLET.clubeId),
      ).resolves.toEqual({
        balance: '100.00',
        version: 3,
      });
    });

    it('lança 404 quando o usuário não tem carteira', async () => {
      const { service, prisma } = buildService();
      prisma.wallet.findUnique.mockResolvedValue(null);

      await expect(
        service.getBalance('sem-wallet', WALLET.clubeId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('mesmo usuário, dois clubes diferentes: saldos independentes', async () => {
      const { service, prisma } = buildService();
      const walletClubeA = WALLET;
      const walletClubeB: Wallet = {
        ...WALLET,
        id: 'wallet-2',
        clubeId: 'clube-2',
        balance: new Prisma.Decimal('9.00'),
        version: 0,
      };

      prisma.wallet.findUnique.mockImplementation(
        ({ where }: { where: { userId_clubeId: { clubeId: string } } }) =>
          Promise.resolve(
            where.userId_clubeId.clubeId === walletClubeA.clubeId
              ? walletClubeA
              : walletClubeB,
          ),
      );

      await expect(
        service.getBalance(WALLET.userId, walletClubeA.clubeId),
      ).resolves.toEqual({ balance: '100.00', version: 3 });
      await expect(
        service.getBalance(WALLET.userId, walletClubeB.clubeId),
      ).resolves.toEqual({ balance: '9.00', version: 0 });

      // Operar num clube (débito via ledger) não pode tocar o saldo do outro.
      mockLockedWallet(prisma, walletClubeA.balance.toString());
      await service.applyLedgerEntry(prisma.tx as never, walletClubeA.id, {
        type: 'ADJUSTMENT',
        amount: new Prisma.Decimal('-20.00'),
        idempotencyKey: 'adj-clube-a',
      });

      expect(prisma.tx.wallet.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: walletClubeA.id } }),
      );
      expect(prisma.tx.wallet.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: walletClubeB.id } }),
      );
      await expect(
        service.getBalance(WALLET.userId, walletClubeB.clubeId),
      ).resolves.toEqual({ balance: '9.00', version: 0 });
    });
  });

  describe('getTransactions', () => {
    it('pagina por cursor (createdAt desc) e devolve nextCursor só quando há mais páginas', async () => {
      const { service, prisma } = buildService();
      prisma.wallet.findUnique.mockResolvedValue(WALLET);
      const rows = Array.from({ length: 3 }, (_, i) => ({
        id: `txn-${i}`,
        walletId: WALLET.id,
        type: 'PIX_DEPOSIT',
        status: 'COMPLETED',
        amount: new Prisma.Decimal('10.00'),
        balanceAfter: new Prisma.Decimal('10.00'),
        idempotencyKey: `k-${i}`,
        description: null,
        pixChargeId: null,
        pixWithdrawalId: null,
        tableSessionId: null,
        tournamentEntryId: null,
        createdById: null,
        createdAt: new Date(2026, 0, i + 1),
      }));
      prisma.walletTransaction.findMany.mockResolvedValue(rows.slice(0, 2)); // limit=2, sem +1 -> sem próxima página

      const page = await service.getTransactions(
        WALLET.userId,
        WALLET.clubeId,
        undefined,
        2,
      );
      expect(page.items).toHaveLength(2);
      expect(page.nextCursor).toBeNull();
    });
  });

  // Gateway (AbacatePay) em standby — ver docblock de
  // `WalletService.createDeposit`. Recusa sempre, incondicionalmente
  // (nem depende mais de `wallet.paymentsEnabled`, diferente de antes).
  describe('gateway PIX em standby', () => {
    it('createDeposit sempre recusa com 503', async () => {
      const { service } = buildService();
      await expect(
        service.createDeposit(
          WALLET.userId,
          WALLET.clubeId,
          { amount: '50.00' },
          'idem-1',
        ),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('requestWithdrawal sempre recusa com 503', async () => {
      const { service } = buildService();
      await expect(
        service.requestWithdrawal(
          WALLET.userId,
          WALLET.clubeId,
          { amount: '50.00', pixKey: 'a@b.com', pixKeyType: 'EMAIL' },
          'idem-1',
        ),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('handleWebhook sempre recusa com 503', async () => {
      const { service } = buildService();
      await expect(
        service.handleWebhook(Buffer.from('{}'), 'algum-secret', undefined),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  describe('pagamentos em standby (wallet.paymentsEnabled = false)', () => {
    describe('applyLedgerEntry', () => {
      it('com a flag ligada (produção), comportamento idêntico ao de hoje: 422 de saldo insuficiente', async () => {
        const { service, prisma } = buildService({ paymentsEnabled: true });
        mockLockedWallet(prisma, '5.00');

        await expect(
          service.applyLedgerEntry(prisma.tx as never, WALLET.id, {
            type: 'TABLE_BUY_IN',
            amount: new Prisma.Decimal('-50.00'),
            idempotencyKey: 'buyin-1',
          }),
        ).rejects.toBeInstanceOf(UnprocessableEntityException);
        expect(prisma.tx.walletTransaction.create).not.toHaveBeenCalled();
      });

      it('em standby, cobre a diferença com um ADJUSTMENT e completa o débito sem lançar', async () => {
        const { service, prisma } = buildService({ paymentsEnabled: false });
        mockLockedWallet(prisma, '5.00');
        prisma.tx.walletTransaction.create.mockImplementation(
          ({ data }: { data: Record<string, unknown> }) =>
            Promise.resolve({ id: 'txn-fake', ...data }),
        );

        const result = await service.applyLedgerEntry(
          prisma.tx as never,
          WALLET.id,
          {
            type: 'TABLE_BUY_IN',
            amount: new Prisma.Decimal('-50.00'),
            idempotencyKey: 'buyin-1',
          },
        );

        // Duas escritas no ledger: o ADJUSTMENT automático (+45, cobre o
        // buraco de 5→-50) e o débito original de -50, saldo final 0 — nunca
        // negativo (CHECK wallets_balance_non_negative).
        expect(prisma.tx.walletTransaction.create).toHaveBeenCalledTimes(2);
        const [topUpCall, debitCall] = prisma.tx.walletTransaction.create.mock
          .calls as Array<[{ data: Record<string, unknown> }]>;
        const topUp = topUpCall[0].data;
        expect(topUp).toMatchObject({
          walletId: WALLET.id,
          type: 'ADJUSTMENT',
          idempotencyKey: 'standby-topup:buyin-1',
        });
        expect((topUp.amount as Prisma.Decimal).toFixed(2)).toBe('45.00');
        expect((topUp.balanceAfter as Prisma.Decimal).toFixed(2)).toBe('50.00');

        const debit = debitCall[0].data;
        expect(debit).toMatchObject({
          walletId: WALLET.id,
          type: 'TABLE_BUY_IN',
          idempotencyKey: 'buyin-1',
        });
        expect((debit.balanceAfter as Prisma.Decimal).toFixed(2)).toBe('0.00');

        const updateCall = prisma.tx.wallet.update.mock.calls[0] as [
          { where: { id: string }; data: { balance: Prisma.Decimal } },
        ];
        expect(updateCall[0].where).toEqual({ id: WALLET.id });
        expect(updateCall[0].data.balance.toFixed(2)).toBe('0.00');

        expect(result.idempotencyKey).toBe('buyin-1'); // devolve o débito, não o ajuste
      });

      it('em standby, saldo já suficiente não gera ADJUSTMENT nenhum (só cobre o que falta)', async () => {
        const { service, prisma } = buildService({ paymentsEnabled: false });
        mockLockedWallet(prisma, '100.00');

        await service.applyLedgerEntry(prisma.tx as never, WALLET.id, {
          type: 'TABLE_BUY_IN',
          amount: new Prisma.Decimal('-50.00'),
          idempotencyKey: 'buyin-2',
        });

        expect(prisma.tx.walletTransaction.create).toHaveBeenCalledTimes(1); // só o débito
        expect(prisma.tx.walletTransaction.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ type: 'TABLE_BUY_IN' }) as unknown,
          }),
        );
      });
    });
  });
});
