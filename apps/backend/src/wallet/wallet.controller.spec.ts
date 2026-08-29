import { BadRequestException, NotImplementedException } from '@nestjs/common';
import type { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';

/**
 * TODO(CL-BE-07): controller inoperante até a rota de clube existir — ver
 * docblock em `wallet.controller.ts`. Estes testes só travam o
 * comportamento atual (501 explícito / idempotency-key ainda validada antes
 * do 501); a cobertura de comportamento por (usuário, clube) está em
 * `wallet.service.spec.ts`.
 */
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
  it('getBalance: 501 (rota de clube pendente — CL-BE-07)', () => {
    const { controller, walletService } = buildController();
    expect(() => controller.getBalance()).toThrow(NotImplementedException);
    expect(walletService.getBalance).not.toHaveBeenCalled();
  });

  it('getTransactions: 501 (rota de clube pendente — CL-BE-07)', () => {
    const { controller, walletService } = buildController();
    expect(() => controller.getTransactions()).toThrow(NotImplementedException);
    expect(walletService.getTransactions).not.toHaveBeenCalled();
  });

  describe('createDeposit', () => {
    it('exige o header Idempotency-Key mesmo com a rota inoperante', () => {
      const { controller } = buildController();
      expect(() => controller.createDeposit(undefined)).toThrow(
        BadRequestException,
      );
    });

    it('rejeita header vazio/só espaços', () => {
      const { controller } = buildController();
      expect(() => controller.createDeposit('   ')).toThrow(
        BadRequestException,
      );
    });

    it('com header presente, ainda é 501 (rota de clube pendente — CL-BE-07)', () => {
      const { controller, walletService } = buildController();
      expect(() => controller.createDeposit('idem-1')).toThrow(
        NotImplementedException,
      );
      expect(walletService.createDeposit).not.toHaveBeenCalled();
    });
  });

  describe('requestWithdrawal', () => {
    it('exige o header Idempotency-Key mesmo com a rota inoperante', () => {
      const { controller } = buildController();
      expect(() => controller.requestWithdrawal(undefined)).toThrow(
        BadRequestException,
      );
    });

    it('com header presente, ainda é 501 (rota de clube pendente — CL-BE-07)', () => {
      const { controller, walletService } = buildController();
      expect(() => controller.requestWithdrawal('idem-1')).toThrow(
        NotImplementedException,
      );
      expect(walletService.requestWithdrawal).not.toHaveBeenCalled();
    });
  });
});
