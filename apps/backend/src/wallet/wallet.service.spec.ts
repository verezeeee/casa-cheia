import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Prisma, type PixCharge, type Wallet } from '@prisma/client';
import { createHmac } from 'node:crypto';
import {
  AbacatePayRequestError,
  AbacatePayUnavailableError,
} from '../integrations/abacatepay';
import type { AbacatePayClient } from '../integrations/abacatepay';
import type { PrismaService } from '../prisma/prisma.service';
import { WalletService } from './wallet.service';

const WALLET: Wallet = {
  id: 'wallet-1',
  userId: 'user-1',
  balance: new Prisma.Decimal('100.00'),
  version: 3,
  blockedAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

const WALLET_CONFIG = {
  minDeposit: '10.00',
  maxDeposit: '5000.00',
  minWithdrawal: '10.00',
};
const ABACATEPAY_CONFIG = {
  webhookSecret: 'shh-secret',
  webhookToleranceSeconds: 300,
};

/** Fake mínimo de `PrismaService`, com o `tx` interativo compartilhado entre chamadas. */
function buildPrisma() {
  const tx = {
    $queryRaw: jest.fn(),
    walletTransaction: { create: jest.fn() },
    wallet: { update: jest.fn() },
    pixWithdrawal: { create: jest.fn(), update: jest.fn() },
    pixCharge: { update: jest.fn() },
  };

  return {
    tx,
    wallet: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn() },
    walletTransaction: { findMany: jest.fn(), findUnique: jest.fn() },
    pixCharge: { create: jest.fn(), findUnique: jest.fn() },
    pixWithdrawal: {
      create: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
    },
    webhookEvent: { create: jest.fn(), update: jest.fn() },
    $transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
  };
}

function buildService(overrides?: { prisma?: ReturnType<typeof buildPrisma> }) {
  const prisma = overrides?.prisma ?? buildPrisma();

  const configGet = jest.fn((key: string) => {
    if (key === 'wallet') return WALLET_CONFIG;
    if (key === 'abacatePay') return ABACATEPAY_CONFIG;
    return undefined;
  });
  const configService = { get: configGet };

  const abacatePayClient: jest.Mocked<
    Pick<AbacatePayClient, 'createPixCharge' | 'requestPixWithdrawal'>
  > = {
    createPixCharge: jest.fn(),
    requestPixWithdrawal: jest.fn(),
  };

  const service = new WalletService(
    prisma as unknown as PrismaService,
    configService as unknown as ConfigService,
    abacatePayClient as unknown as AbacatePayClient,
  );

  return { service, prisma, configService, abacatePayClient };
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

      await expect(service.getBalance(WALLET.userId)).resolves.toEqual({
        balance: '100.00',
        version: 3,
      });
    });

    it('lança 404 quando o usuário não tem carteira', async () => {
      const { service, prisma } = buildService();
      prisma.wallet.findUnique.mockResolvedValue(null);

      await expect(service.getBalance('sem-wallet')).rejects.toBeInstanceOf(
        NotFoundException,
      );
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

      const page = await service.getTransactions(WALLET.userId, undefined, 2);
      expect(page.items).toHaveLength(2);
      expect(page.nextCursor).toBeNull();
    });
  });

  describe('createDeposit', () => {
    it('rejeita valor abaixo do mínimo configurado', async () => {
      const { service, prisma } = buildService();
      prisma.wallet.findUnique.mockResolvedValue(WALLET);

      await expect(
        service.createDeposit(WALLET.userId, { amount: '5.00' }, 'idem-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejeita valor acima do máximo configurado', async () => {
      const { service, prisma } = buildService();
      prisma.wallet.findUnique.mockResolvedValue(WALLET);

      await expect(
        service.createDeposit(WALLET.userId, { amount: '99999.00' }, 'idem-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('cria a cobrança no gateway usando a idempotency key como externalReferenceId', async () => {
      const { service, prisma, abacatePayClient } = buildService();
      prisma.wallet.findUnique.mockResolvedValue(WALLET);
      abacatePayClient.createPixCharge.mockResolvedValue({
        externalId: 'ext-1',
        status: 'PENDING',
        rawStatus: 'PENDING',
        amount: '50.00',
        brCode: '000201...',
        expiresAt: '2026-01-01T01:00:00.000Z',
        createdAt: '2026-01-01T00:00:00.000Z',
      });
      const created: PixCharge = {
        id: 'charge-1',
        userId: WALLET.userId,
        externalId: 'ext-1',
        amount: new Prisma.Decimal('50.00'),
        status: 'PENDING',
        qrCodePayload: '000201...',
        qrCodeImageUrl: null,
        expiresAt: new Date('2026-01-01T01:00:00.000Z'),
        paidAt: null,
        rawPayload: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      prisma.pixCharge.create.mockResolvedValue(created);

      const result = await service.createDeposit(
        WALLET.userId,
        { amount: '50.00' },
        'idem-1',
      );

      expect(abacatePayClient.createPixCharge).toHaveBeenCalledWith(
        expect.objectContaining({ externalReferenceId: 'deposit:idem-1' }),
      );
      expect(result).toMatchObject({ id: 'charge-1', amount: '50.00' });
    });

    it('traduz falha do gateway (AbacatePayError) em 503, nunca deixa vazar como 500 opaco', async () => {
      const { service, prisma, abacatePayClient } = buildService();
      prisma.wallet.findUnique.mockResolvedValue(WALLET);
      abacatePayClient.createPixCharge.mockRejectedValue(
        new AbacatePayRequestError('recusado', 'createPixCharge', {
          status: 401,
          responseBody: undefined,
        }),
      );

      await expect(
        service.createDeposit(WALLET.userId, { amount: '50.00' }, 'idem-1'),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(prisma.pixCharge.create).not.toHaveBeenCalled();
    });
  });

  describe('requestWithdrawal', () => {
    it('rejeita valor abaixo do mínimo configurado', async () => {
      const { service, prisma } = buildService();
      prisma.wallet.findUnique.mockResolvedValue(WALLET);

      await expect(
        service.requestWithdrawal(
          WALLET.userId,
          { amount: '5.00', pixKey: 'a@b.com', pixKeyType: 'EMAIL' },
          'idem-1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejeita quando o saldo é insuficiente (CHECK simulado pelo helper de ledger)', async () => {
      const { service, prisma } = buildService();
      prisma.wallet.findUnique.mockResolvedValue(WALLET);
      prisma.walletTransaction.findUnique.mockResolvedValue(null);
      mockLockedWallet(prisma, '5.00'); // saldo travado é menor que o saque pedido

      await expect(
        service.requestWithdrawal(
          WALLET.userId,
          { amount: '50.00', pixKey: 'a@b.com', pixKeyType: 'EMAIL' },
          'idem-1',
        ),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('devolve o saque já existente sem debitar/chamar o gateway de novo (replay idempotente)', async () => {
      const { service, prisma, abacatePayClient } = buildService();
      prisma.wallet.findUnique.mockResolvedValue(WALLET);
      prisma.walletTransaction.findUnique.mockResolvedValue({
        id: 'txn-existing',
      });
      prisma.pixWithdrawal.findFirst.mockResolvedValue({
        id: 'wdr-1',
        userId: WALLET.userId,
        externalId: 'ext-1',
        amount: new Prisma.Decimal('20.00'),
        pixKey: 'a@b.com',
        pixKeyType: 'EMAIL',
        status: 'PROCESSING',
        failureReason: null,
        processedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.requestWithdrawal(
        WALLET.userId,
        { amount: '20.00', pixKey: 'a@b.com', pixKeyType: 'EMAIL' },
        'idem-1',
      );

      expect(result).toMatchObject({ id: 'wdr-1' });
      expect(abacatePayClient.requestPixWithdrawal).not.toHaveBeenCalled();
    });

    it('debita, chama o gateway e marca PROCESSING em caso de sucesso', async () => {
      const { service, prisma, abacatePayClient } = buildService();
      prisma.wallet.findUnique.mockResolvedValue(WALLET);
      prisma.walletTransaction.findUnique.mockResolvedValue(null);
      mockLockedWallet(prisma, '100.00');
      prisma.tx.pixWithdrawal.create.mockResolvedValue({
        id: 'wdr-1',
        amount: new Prisma.Decimal('20.00'),
      });
      abacatePayClient.requestPixWithdrawal.mockResolvedValue({
        externalId: 'ext-1',
        status: 'PENDING',
        rawStatus: 'PENDING',
        amount: '20.00',
        createdAt: new Date().toISOString(),
      });
      prisma.pixWithdrawal.update.mockResolvedValue({
        id: 'wdr-1',
        userId: WALLET.userId,
        externalId: 'ext-1',
        amount: new Prisma.Decimal('20.00'),
        pixKey: 'a@b.com',
        pixKeyType: 'EMAIL',
        status: 'PROCESSING',
        failureReason: null,
        processedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.requestWithdrawal(
        WALLET.userId,
        { amount: '20.00', pixKey: 'a@b.com', pixKeyType: 'EMAIL' },
        'idem-1',
      );

      expect(prisma.tx.walletTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amount: expect.any(Prisma.Decimal) as unknown,
          }),
        }),
      );
      expect(result.status).toBe('PROCESSING');
    });

    it('estorna o débito (lançamento inverso) quando o gateway recusa definitivamente (4xx)', async () => {
      const { service, prisma, abacatePayClient } = buildService();
      prisma.wallet.findUnique.mockResolvedValue(WALLET);
      prisma.walletTransaction.findUnique.mockResolvedValue(null);
      mockLockedWallet(prisma, '100.00');
      prisma.tx.pixWithdrawal.create.mockResolvedValue({ id: 'wdr-1' });
      abacatePayClient.requestPixWithdrawal.mockRejectedValue(
        new AbacatePayRequestError(
          'chave pix inválida',
          'requestPixWithdrawal',
          {
            status: 400,
            responseBody: {},
          },
        ),
      );
      prisma.tx.pixWithdrawal.update.mockResolvedValue({
        id: 'wdr-1',
        userId: WALLET.userId,
        externalId: null,
        amount: new Prisma.Decimal('20.00'),
        pixKey: 'a@b.com',
        pixKeyType: 'EMAIL',
        status: 'FAILED',
        failureReason: 'chave pix inválida',
        processedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.requestWithdrawal(
        WALLET.userId,
        { amount: '20.00', pixKey: 'a@b.com', pixKeyType: 'EMAIL' },
        'idem-1',
      );

      // Dois lançamentos no ledger: o débito original + o estorno.
      expect(prisma.tx.walletTransaction.create).toHaveBeenCalledTimes(2);
      expect(result.status).toBe('FAILED');
    });

    it('NÃO estorna quando o gateway está indisponível (falha indeterminada) — fica pendente', async () => {
      const { service, prisma, abacatePayClient } = buildService();
      prisma.wallet.findUnique.mockResolvedValue(WALLET);
      prisma.walletTransaction.findUnique.mockResolvedValue(null);
      mockLockedWallet(prisma, '100.00');
      prisma.tx.pixWithdrawal.create.mockResolvedValue({ id: 'wdr-1' });
      abacatePayClient.requestPixWithdrawal.mockRejectedValue(
        new AbacatePayUnavailableError('timeout', 'requestPixWithdrawal', {
          attempts: 2,
        }),
      );

      await expect(
        service.requestWithdrawal(
          WALLET.userId,
          { amount: '20.00', pixKey: 'a@b.com', pixKeyType: 'EMAIL' },
          'idem-1',
        ),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);

      // Só o débito original — nenhum estorno foi lançado.
      expect(prisma.tx.walletTransaction.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleWebhook', () => {
    function sign(body: string, timestamp: string): string {
      return createHmac('sha256', ABACATEPAY_CONFIG.webhookSecret)
        .update(`${timestamp}.${body}`)
        .digest('hex');
    }

    it('rejeita sem assinatura/timestamp', async () => {
      const { service } = buildService();
      await expect(
        service.handleWebhook(Buffer.from('{}'), undefined, undefined),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejeita timestamp fora da janela anti-replay', async () => {
      const { service } = buildService();
      const body = '{}';
      const oldTimestamp = String(Math.floor(Date.now() / 1000) - 10_000);

      await expect(
        service.handleWebhook(
          Buffer.from(body),
          sign(body, oldTimestamp),
          oldTimestamp,
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejeita assinatura inválida', async () => {
      const { service } = buildService();
      const body = '{}';
      const timestamp = String(Math.floor(Date.now() / 1000));

      await expect(
        service.handleWebhook(
          Buffer.from(body),
          'assinatura-forjada',
          timestamp,
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('evento duplicado (replay do provedor) é no-op idempotente', async () => {
      const { service, prisma } = buildService();
      const body = JSON.stringify({
        id: 'evt-1',
        event: 'billing.paid',
        data: { id: 'chg-1' },
      });
      const timestamp = String(Math.floor(Date.now() / 1000));
      prisma.webhookEvent.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicate', {
          code: 'P2002',
          clientVersion: '6.19.3',
        }),
      );

      await expect(
        service.handleWebhook(
          Buffer.from(body),
          sign(body, timestamp),
          timestamp,
        ),
      ).resolves.toBeUndefined();
      expect(prisma.pixCharge.findUnique).not.toHaveBeenCalled();
    });

    it('credita a wallet quando o evento é billing.paid e a cobrança existe', async () => {
      const { service, prisma } = buildService();
      const body = JSON.stringify({
        id: 'evt-2',
        event: 'billing.paid',
        data: { id: 'chg-1' },
      });
      const timestamp = String(Math.floor(Date.now() / 1000));
      prisma.webhookEvent.create.mockResolvedValue({ id: 'we-1' });
      prisma.pixCharge.findUnique.mockResolvedValue({
        id: 'charge-1',
        userId: WALLET.userId,
        status: 'PENDING',
        amount: new Prisma.Decimal('50.00'),
      });
      prisma.wallet.findUniqueOrThrow.mockResolvedValue(WALLET);
      mockLockedWallet(prisma, '100.00');

      await service.handleWebhook(
        Buffer.from(body),
        sign(body, timestamp),
        timestamp,
      );

      expect(prisma.tx.walletTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'PIX_DEPOSIT',
            pixChargeId: 'charge-1',
          }),
        }),
      );
      expect(prisma.tx.pixCharge.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PAID' }),
        }),
      );
      expect(prisma.webhookEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            processedAt: expect.any(Date) as unknown,
          }),
        }),
      );
    });

    it('cobrança já paga não gera segundo crédito (defesa redundante)', async () => {
      const { service, prisma } = buildService();
      const body = JSON.stringify({
        id: 'evt-3',
        event: 'billing.paid',
        data: { id: 'chg-1' },
      });
      const timestamp = String(Math.floor(Date.now() / 1000));
      prisma.webhookEvent.create.mockResolvedValue({ id: 'we-1' });
      prisma.pixCharge.findUnique.mockResolvedValue({
        id: 'charge-1',
        userId: WALLET.userId,
        status: 'PAID',
        amount: new Prisma.Decimal('50.00'),
      });

      await service.handleWebhook(
        Buffer.from(body),
        sign(body, timestamp),
        timestamp,
      );

      expect(prisma.wallet.findUniqueOrThrow).not.toHaveBeenCalled();
    });
  });
});
