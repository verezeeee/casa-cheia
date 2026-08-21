import { BadRequestException } from '@nestjs/common';
import type {
  PixChargeResponse,
  PixChargeStatus as SharedPixChargeStatus,
  PixWithdrawalResponse,
  PixWithdrawalStatus as SharedPixWithdrawalStatus,
  WalletBalanceResponse,
  WalletTransactionDto,
  WalletTransactionStatus as SharedWalletTransactionStatus,
  WalletTransactionType as SharedWalletTransactionType,
} from '@poker-system/shared';
import type {
  PixCharge,
  PixWithdrawal,
  Wallet,
  WalletTransaction,
} from '@prisma/client';

/** Dinheiro nunca sai como `number` — `Decimal.toFixed(2)` fixa as 2 casas contratadas em `MoneyString`. */
const toMoney = (value: { toFixed: (digits: number) => string }): string =>
  value.toFixed(2);

export function toWalletBalanceResponse(wallet: Wallet): WalletBalanceResponse {
  return { balance: toMoney(wallet.balance), version: wallet.version };
}

export function toWalletTransactionDto(
  transaction: WalletTransaction,
): WalletTransactionDto {
  return {
    id: transaction.id,
    // Mesmos literais em Prisma e @poker-system/shared (ver base.prisma) —
    // o cast só cruza duas declarações `enum` distintas em TS.
    type: transaction.type as unknown as SharedWalletTransactionType,
    status: transaction.status as unknown as SharedWalletTransactionStatus,
    amount: toMoney(transaction.amount),
    balanceAfter: toMoney(transaction.balanceAfter),
    description: transaction.description,
    createdAt: transaction.createdAt.toISOString(),
  };
}

export function toPixChargeResponse(charge: PixCharge): PixChargeResponse {
  return {
    id: charge.id,
    amount: toMoney(charge.amount),
    status: charge.status as unknown as SharedPixChargeStatus,
    qrCodePayload: charge.qrCodePayload,
    qrCodeImageUrl: charge.qrCodeImageUrl,
    expiresAt: charge.expiresAt.toISOString(),
  };
}

export function toPixWithdrawalResponse(
  withdrawal: PixWithdrawal,
): PixWithdrawalResponse {
  return {
    id: withdrawal.id,
    amount: toMoney(withdrawal.amount),
    status: withdrawal.status as unknown as SharedPixWithdrawalStatus,
    pixKeyMasked: maskPixKey(withdrawal.pixKey),
    failureReason: withdrawal.failureReason,
    createdAt: withdrawal.createdAt.toISOString(),
  };
}

/** Só os últimos 4 caracteres — a chave completa é dado pessoal (LGPD), nunca devolvida. */
function maskPixKey(pixKey: string): string {
  const visible = pixKey.slice(-4);
  return `***${visible}`;
}

/** Cursor opaco de `PaginatedResponse` (keyset por `createdAt` + `id`, ver `WalletService.getTransactions`). */
export interface TransactionCursor {
  createdAt: Date;
  id: string;
}

export function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(
    JSON.stringify({ createdAt: row.createdAt.toISOString(), id: row.id }),
  ).toString('base64url');
}

export function decodeCursor(cursor: string): TransactionCursor {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as {
      createdAt: string;
      id: string;
    };
    const createdAt = new Date(parsed.createdAt);
    if (typeof parsed.id !== 'string' || Number.isNaN(createdAt.getTime())) {
      throw new Error('shape inválido');
    }
    return { createdAt, id: parsed.id };
  } catch {
    throw new BadRequestException('cursor inválido.');
  }
}
