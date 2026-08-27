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

    await expect(
      controller.handle(req, 'secret-header', 'secret-query'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('repassa o corpo bruto e o secret (header e query) ao service', async () => {
    const { controller, walletService } = buildController();
    const rawBody = Buffer.from('{"id":"evt-1"}');
    const req = { rawBody } as unknown as Request;

    await controller.handle(req, 'secret-header', 'secret-query');

    expect(walletService.handleWebhook).toHaveBeenCalledWith(
      rawBody,
      'secret-header',
      'secret-query',
    );
  });
});
