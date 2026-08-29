import {
  Controller,
  Get,
  Headers,
  NotImplementedException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type {
  PaginatedResponse,
  PixChargeResponse,
  PixWithdrawalResponse,
  WalletBalanceResponse,
  WalletTransactionDto,
} from '@poker-system/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SENSITIVE_ROUTE_THROTTLE } from '../common/http/rate-limits';
import { requireIdempotencyKey } from '../common/http/require-idempotency-key';
import { WalletService } from './wallet.service';

/**
 * TODO(CL-BE-07): `WalletService` agora exige `clubeId` (CL-BE-04, carteira
 * por (usuário, clube)) e este controller ainda não tem rota de clube — essa
 * migração (`/wallet` → `/clubes/:clubeId/carteira`) é escopo de CL-BE-07,
 * não desta tarefa. Em vez de inventar uma origem provisória para o
 * `clubeId` (query param, header, etc.) que CL-BE-07 teria que desfazer,
 * cada endpoint fica deliberadamente INOPERANTE (`501 Not Implemented`) até
 * a rota de clube existir. A cobertura de comportamento por clube fica
 * inteiramente em `wallet.service.spec.ts` (unit) — não há e2e aqui.
 */
const CLUBE_ROUTE_PENDENTE =
  'Rota de carteira por clube pendente (CL-BE-07): /clubes/:clubeId/carteira ainda não existe.';

@Controller('wallet')
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get('balance')
  getBalance(): WalletBalanceResponse {
    throw new NotImplementedException(CLUBE_ROUTE_PENDENTE);
  }

  @Get('transactions')
  getTransactions(): PaginatedResponse<WalletTransactionDto> {
    throw new NotImplementedException(CLUBE_ROUTE_PENDENTE);
  }

  @Post('deposits')
  @Throttle(SENSITIVE_ROUTE_THROTTLE)
  createDeposit(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): PixChargeResponse {
    requireIdempotencyKey(idempotencyKey);
    throw new NotImplementedException(CLUBE_ROUTE_PENDENTE);
  }

  @Post('withdrawals')
  @Throttle(SENSITIVE_ROUTE_THROTTLE)
  requestWithdrawal(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): PixWithdrawalResponse {
    requireIdempotencyKey(idempotencyKey);
    throw new NotImplementedException(CLUBE_ROUTE_PENDENTE);
  }
}
