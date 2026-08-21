import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
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
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { SENSITIVE_ROUTE_THROTTLE } from '../common/http/rate-limits';
import { requireIdempotencyKey } from '../common/http/require-idempotency-key';
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
  @Throttle(SENSITIVE_ROUTE_THROTTLE)
  async createDeposit(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateDepositDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<PixChargeResponse> {
    requireIdempotencyKey(idempotencyKey);
    return this.walletService.createDeposit(user.id, dto, idempotencyKey);
  }

  @Post('withdrawals')
  @Throttle(SENSITIVE_ROUTE_THROTTLE)
  async requestWithdrawal(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RequestWithdrawalDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<PixWithdrawalResponse> {
    requireIdempotencyKey(idempotencyKey);
    return this.walletService.requestWithdrawal(user.id, dto, idempotencyKey);
  }
}
