import { BadRequestException } from '@nestjs/common';
import { PixChargeStatus, PixWithdrawalStatus } from '@poker-system/shared';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { WalletController } from './wallet.controller';
import type { WalletService } from './wallet.service';

const USER: AuthenticatedUser = {
  id: 'user-1',
  email: 'a@b.dev',
  role: 'PLAYER',
};

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
  it('getBalance delega ao service com o id do usuário autenticado', async () => {
    const { controller, walletService } = buildController();
    walletService.getBalance.mockResolvedValue({
      balance: '10.00',
      version: 1,
    });

    await expect(controller.getBalance(USER)).resolves.toEqual({
      balance: '10.00',
      version: 1,
    });
    expect(walletService.getBalance).toHaveBeenCalledWith(USER.id);
  });

  it('getTransactions repassa cursor e limit da query', async () => {
    const { controller, walletService } = buildController();
    walletService.getTransactions.mockResolvedValue({
      items: [],
      nextCursor: null,
    });

    await controller.getTransactions(USER, { cursor: 'abc', limit: 5 });
    expect(walletService.getTransactions).toHaveBeenCalledWith(
      USER.id,
      'abc',
      5,
    );
  });

  describe('createDeposit', () => {
    it('exige o header Idempotency-Key', async () => {
      const { controller } = buildController();
      await expect(
        controller.createDeposit(USER, { amount: '50.00' }, undefined),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejeita header vazio/só espaços', async () => {
      const { controller } = buildController();
      await expect(
        controller.createDeposit(USER, { amount: '50.00' }, '   '),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('delega ao service quando o header está presente', async () => {
      const { controller, walletService } = buildController();
      walletService.createDeposit.mockResolvedValue({
        id: 'chg-1',
        amount: '50.00',
        status: PixChargeStatus.PENDING,
        qrCodePayload: '000201',
        qrCodeImageUrl: null,
        expiresAt: new Date().toISOString(),
      });

      await controller.createDeposit(USER, { amount: '50.00' }, 'idem-1');
      expect(walletService.createDeposit).toHaveBeenCalledWith(
        USER.id,
        { amount: '50.00' },
        'idem-1',
      );
    });
  });

  describe('requestWithdrawal', () => {
    it('exige o header Idempotency-Key', async () => {
      const { controller } = buildController();
      await expect(
        controller.requestWithdrawal(
          USER,
          { amount: '30.00', pixKey: 'a@b.com', pixKeyType: 'EMAIL' },
          undefined,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('delega ao service quando o header está presente', async () => {
      const { controller, walletService } = buildController();
      walletService.requestWithdrawal.mockResolvedValue({
        id: 'wdr-1',
        amount: '30.00',
        status: PixWithdrawalStatus.PROCESSING,
        pixKeyMasked: '***.com',
        failureReason: null,
        createdAt: new Date().toISOString(),
      });

      const dto = {
        amount: '30.00',
        pixKey: 'a@b.com',
        pixKeyType: 'EMAIL' as const,
      };
      await controller.requestWithdrawal(USER, dto, 'idem-1');
      expect(walletService.requestWithdrawal).toHaveBeenCalledWith(
        USER.id,
        dto,
        'idem-1',
      );
    });
  });
});
