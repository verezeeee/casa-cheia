import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { WalletService } from './wallet.service';

/**
 * Endpoint público (sem `JwtAuthGuard`): o AbacatePay chama diretamente, sem
 * sessão de usuário. A autenticação é a assinatura HMAC do corpo (ver
 * `WalletService.handleWebhook`) — não confiar em nenhum outro dado da
 * requisição sem ela validar primeiro.
 *
 * Precisa do corpo BRUTO (não o JSON já parseado pelo Nest): a assinatura é
 * calculada sobre os bytes exatos recebidos. `main.ts` habilita
 * `rawBody: true` no bootstrap especificamente para isto.
 */
@Controller('webhooks/abacatepay')
export class AbacatePayWebhookController {
  constructor(private readonly walletService: WalletService) {}

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  async handle(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-abacatepay-signature') signature: string | undefined,
    @Headers('x-abacatepay-timestamp') timestamp: string | undefined,
  ): Promise<void> {
    if (!req.rawBody) {
      throw new BadRequestException('Corpo bruto da requisição ausente.');
    }
    await this.walletService.handleWebhook(req.rawBody, signature, timestamp);
  }
}
