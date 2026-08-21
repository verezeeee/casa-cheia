import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type {
  PaginatedResponse,
  PixChargeResponse,
  PixWithdrawalResponse,
  WalletBalanceResponse,
  WalletTransactionDto,
} from '@poker-system/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { CreateDepositDto } from './dto/create-deposit.dto';
import { ListTransactionsQueryDto } from './dto/list-transactions-query.dto';
import { RequestWithdrawalDto } from './dto/request-withdrawal.dto';
import { WalletService } from './wallet.service';

@Controller('wallet')
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get('balance')
  async getBalance(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WalletBalanceResponse> {
    return this.walletService.getBalance(user.id);
  }

  @Get('transactions')
  async getTransactions(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListTransactionsQueryDto,
  ): Promise<PaginatedResponse<WalletTransactionDto>> {
    return this.walletService.getTransactions(
      user.id,
      query.cursor,
      query.limit,
    );
  }

  @Post('deposits')
  async createDeposit(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateDepositDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<PixChargeResponse> {
    requireIdempotencyKey(idempotencyKey);
    return this.walletService.createDeposit(user.id, dto, idempotencyKey);
  }

  @Post('withdrawals')
  async requestWithdrawal(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RequestWithdrawalDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<PixWithdrawalResponse> {
    requireIdempotencyKey(idempotencyKey);
    return this.walletService.requestWithdrawal(user.id, dto, idempotencyKey);
  }
}

/**
 * `Idempotency-Key` é obrigatório em toda operação financeira que dispara
 * efeito colateral externo (decisão D-04 de `base.prisma`). Validação ad-hoc
 * aqui; generalizada em interceptor na Fase 5, quando Wallet/Table/Tournament
 * já tiverem endpoints suficientes para justificar a abstração compartilhada.
 */
function requireIdempotencyKey(
  value: string | undefined,
): asserts value is string {
  if (!value || value.trim().length === 0) {
    throw new BadRequestException('Header Idempotency-Key é obrigatório.');
  }
}
