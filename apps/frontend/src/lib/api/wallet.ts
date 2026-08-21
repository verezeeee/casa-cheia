import type {
  PaginatedResponse,
  PixChargeResponse,
  PixWithdrawalResponse,
  WalletBalanceResponse,
  WalletTransactionDto,
} from '@poker-system/shared';
import { httpClient } from '../http-client';
import type { CreateDepositRequest, RequestWithdrawalRequest } from './types';

const WALLET_PATHS = {
  balance: '/wallet/balance',
  transactions: '/wallet/transactions',
  deposits: '/wallet/deposits',
  withdrawals: '/wallet/withdrawals',
} as const;

export function getBalance(): Promise<WalletBalanceResponse> {
  return httpClient.get<WalletBalanceResponse>(WALLET_PATHS.balance);
}

export function getTransactions(cursor?: string): Promise<PaginatedResponse<WalletTransactionDto>> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return httpClient.get<PaginatedResponse<WalletTransactionDto>>(
    `${WALLET_PATHS.transactions}${query}`,
  );
}

/**
 * `idempotencyKey`: gerado pelo CHAMADOR (não aqui) e reaproveitado em um
 * retry de UI (ex.: usuário perde conexão e clica de novo) — o backend exige
 * o header em toda operação financeira (ver `WalletController`).
 */
export function createDeposit(
  input: CreateDepositRequest,
  idempotencyKey: string,
): Promise<PixChargeResponse> {
  return httpClient.post<PixChargeResponse>(WALLET_PATHS.deposits, input, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

export function requestWithdrawal(
  input: RequestWithdrawalRequest,
  idempotencyKey: string,
): Promise<PixWithdrawalResponse> {
  return httpClient.post<PixWithdrawalResponse>(WALLET_PATHS.withdrawals, input, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

export const walletApi = { getBalance, getTransactions, createDeposit, requestWithdrawal };
