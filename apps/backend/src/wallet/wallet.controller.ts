import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
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
import { ClubeMembershipGuard } from '../club/guards/clube-membership.guard';
import { SENSITIVE_ROUTE_THROTTLE } from '../common/http/rate-limits';
import { requireIdempotencyKey } from '../common/http/require-idempotency-key';
import { CreateDepositDto } from './dto/create-deposit.dto';
import { ListTransactionsQueryDto } from './dto/list-transactions-query.dto';
import { RequestWithdrawalDto } from './dto/request-withdrawal.dto';
import { WalletService } from './wallet.service';

@Controller('clubes/:clubeId/carteira')
@UseGuards(JwtAuthGuard, ClubeMembershipGuard)
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get('balance')
  getBalance(
    @Param('clubeId') clubeId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WalletBalanceResponse> {
    return this.walletService.getBalance(user.id, clubeId);
  }

  @Get('transactions')
  getTransactions(
    @Param('clubeId') clubeId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListTransactionsQueryDto,
  ): Promise<PaginatedResponse<WalletTransactionDto>> {
    return this.walletService.getTransactions(
      user.id,
      clubeId,
      query.cursor,
      query.limit,
    );
  }

  @Post('deposits')
  @Throttle(SENSITIVE_ROUTE_THROTTLE)
  createDeposit(
    @Param('clubeId') clubeId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateDepositDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<PixChargeResponse> {
    requireIdempotencyKey(idempotencyKey);
    return this.walletService.createDeposit(
      user.id,
      clubeId,
      dto,
      idempotencyKey,
    );
  }

  @Post('withdrawals')
  @Throttle(SENSITIVE_ROUTE_THROTTLE)
  requestWithdrawal(
    @Param('clubeId') clubeId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RequestWithdrawalDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<PixWithdrawalResponse> {
    requireIdempotencyKey(idempotencyKey);
    return this.walletService.requestWithdrawal(
      user.id,
      clubeId,
      dto,
      idempotencyKey,
    );
  }
}
