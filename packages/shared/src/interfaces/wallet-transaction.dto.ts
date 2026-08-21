import { WalletTransactionStatus } from '../enums/wallet-transaction-status.enum';
import { WalletTransactionType } from '../enums/wallet-transaction-type.enum';
import { MoneyString } from '../types/money';

/**
 * Lançamento do extrato da carteira virtual (razão append-only).
 *
 * Um lançamento nunca é alterado depois de COMPLETED: correções entram como
 * um novo lançamento compensatório (ADJUSTMENT / status REVERSED), preservando
 * a trilha de auditoria.
 */
export interface WalletTransactionDto {
  id: string;

  type: WalletTransactionType;

  status: WalletTransactionStatus;

  /**
   * Valor do lançamento, com sinal: negativo para débitos (buy-in, saque)
   * e positivo para créditos (depósito, cash-out, payout).
   */
  amount: MoneyString;

  /** Saldo da wallet imediatamente após aplicar este lançamento. */
  balanceAfter: MoneyString;

  /** Descrição livre para o extrato; `null` quando não houver. */
  description: string | null;

  /** Data/hora de criação em ISO 8601 UTC (ex.: `'2026-01-31T12:00:00.000Z'`). */
  createdAt: string;
}
