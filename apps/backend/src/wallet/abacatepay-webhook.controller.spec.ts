import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import { AbacatePayWebhookController } from './abacatepay-webhook.controller';
import type { WalletService } from './wallet.service';

function buildController() {
  const walletService: jest.Mocked<Pick<WalletService, 'handleWebhook'>> = {
    handleWebhook: jest.fn(),
  };
  const controller = new AbacatePayWebhookController(
    walletService as unknown as WalletService,
  );
  return { controller, walletService };
}

describe('AbacatePayWebhookController', () => {
  it('rejeita quando o corpo bruto (rawBody) não está disponível', async () => {
    const { controller } = buildController();
    const req = { rawBody: undefined } as unknown as Request;

    await expect(controller.handle(req, 'sig', '123')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('repassa o corpo bruto e os headers de assinatura/timestamp ao service', async () => {
    const { controller, walletService } = buildController();
    const rawBody = Buffer.from('{"id":"evt-1"}');
    const req = { rawBody } as unknown as Request;

    await controller.handle(req, 'sig-abc', '1700000000');

    expect(walletService.handleWebhook).toHaveBeenCalledWith(
      rawBody,
      'sig-abc',
      '1700000000',
    );
  });
});
