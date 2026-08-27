import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { WalletService } from './wallet.service';

/**
 * Endpoint público (sem `JwtAuthGuard`): o AbacatePay chama diretamente, sem
 * sessão de usuário. A autenticação é o secret do webhook (ver
 * `WalletService.verifyWebhookSecret`) — não confiar em nenhum outro dado
 * da requisição sem ele validar primeiro. Confirmado contra uma entrega
 * real: o AbacatePay manda o secret tanto no header `X-Webhook-Secret`
 * quanto na query string `?webhookSecret=...` (mesmo valor, redundante) —
 * aceitamos qualquer um dos dois.
 *
 * Corpo BRUTO (não o JSON já parseado pelo Nest): `parseWebhookEvent`
 * decodifica `rawBody` diretamente. `main.ts` habilita `rawBody: true` no
 * bootstrap especificamente para isto.
 */
@Controller('webhooks/abacatepay')
export class AbacatePayWebhookController {
  constructor(private readonly walletService: WalletService) {}

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  async handle(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-webhook-secret') secretHeader: string | undefined,
    @Query('webhookSecret') secretQuery: string | undefined,
  ): Promise<void> {
    if (!req.rawBody) {
      throw new BadRequestException('Corpo bruto da requisição ausente.');
    }
    await this.walletService.handleWebhook(
      req.rawBody,
      secretHeader,
      secretQuery,
    );
  }
}
