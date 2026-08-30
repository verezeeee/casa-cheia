import { BadRequestException } from '@nestjs/common';
import { PixChargeStatus, PixWithdrawalStatus } from '@poker-system/shared';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import type { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';

const CLUBE_ID = 'clube-1';
const USER: AuthenticatedUser = { id: 'user-1', email: 'user@test.dev' };

function buildController() {
  const walletService: jest.Mocked<
    Pick<
      WalletService,
      'getBalance' | 'getTransactions' | 'createDeposit' | 'requestWithdrawal'
    >
  > = {
    getBalance: jest.fn(),
    getTransactions: jest.fn(),
    createDeposit: jest.fn(),
    requestWithdrawal: jest.fn(),
  };
  const controller = new WalletController(
    walletService as unknown as WalletService,
  );
  return { controller, walletService };
}

describe('WalletController', () => {
  it('getBalance: delega pro service com (userId, clubeId) do request', () => {
    const { controller, walletService } = buildController();
    walletService.getBalance.mockResolvedValue({
      balance: '10.00',
      version: 0,
    });

    controller.getBalance(CLUBE_ID, USER);

    expect(walletService.getBalance).toHaveBeenCalledWith(USER.id, CLUBE_ID);
  });

  it('getTransactions: repassa cursor/limit da query junto com (userId, clubeId)', () => {
    const { controller, walletService } = buildController();
    walletService.getTransactions.mockResolvedValue({
      items: [],
      nextCursor: null,
    });

    controller.getTransactions(CLUBE_ID, USER, { cursor: 'abc', limit: 5 });

    expect(walletService.getTransactions).toHaveBeenCalledWith(
      USER.id,
      CLUBE_ID,
      'abc',
      5,
    );
  });

  describe('createDeposit', () => {
    it('exige o header Idempotency-Key antes de chamar o service', () => {
      const { controller, walletService } = buildController();
      expect(() =>
        controller.createDeposit(
          CLUBE_ID,
          USER,
          { amount: '50.00' },
          undefined,
        ),
      ).toThrow(BadRequestException);
      expect(walletService.createDeposit).not.toHaveBeenCalled();
    });

    it('rejeita header vazio/só espaços', () => {
      const { controller } = buildController();
      expect(() =>
        controller.createDeposit(CLUBE_ID, USER, { amount: '50.00' }, '   '),
      ).toThrow(BadRequestException);
    });

    it('com header presente, delega pro service com (userId, clubeId, dto, idempotencyKey)', () => {
      const { controller, walletService } = buildController();
      walletService.createDeposit.mockResolvedValue({
        id: 'charge-1',
        amount: '50.00',
        status: PixChargeStatus.PENDING,
        qrCodePayload: '000201...',
        qrCodeImageUrl: null,
        expiresAt: new Date().toISOString(),
      });

      controller.createDeposit(CLUBE_ID, USER, { amount: '50.00' }, 'idem-1');

      expect(walletService.createDeposit).toHaveBeenCalledWith(
        USER.id,
        CLUBE_ID,
        { amount: '50.00' },
        'idem-1',
      );
    });
  });

  describe('requestWithdrawal', () => {
    const dto = {
      amount: '20.00',
      pixKey: 'a@b.com',
      pixKeyType: 'EMAIL' as const,
    };

    it('exige o header Idempotency-Key antes de chamar o service', () => {
      const { controller, walletService } = buildController();
      expect(() =>
        controller.requestWithdrawal(CLUBE_ID, USER, dto, undefined),
      ).toThrow(BadRequestException);
      expect(walletService.requestWithdrawal).not.toHaveBeenCalled();
    });

    it('com header presente, delega pro service com (userId, clubeId, dto, idempotencyKey)', () => {
      const { controller, walletService } = buildController();
      walletService.requestWithdrawal.mockResolvedValue({
        id: 'wdr-1',
        amount: '20.00',
        status: PixWithdrawalStatus.PROCESSING,
        pixKeyMasked: '***.com',
        failureReason: null,
        createdAt: new Date().toISOString(),
      });

      controller.requestWithdrawal(CLUBE_ID, USER, dto, 'idem-1');

      expect(walletService.requestWithdrawal).toHaveBeenCalledWith(
        USER.id,
        CLUBE_ID,
        dto,
        'idem-1',
      );
    });
  });
});
