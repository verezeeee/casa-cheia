/**
 * Tipos de movimentação da carteira virtual (Wallet).
 * Usado pelos módulos de depósito/saque via PIX (AbacatePay) e pela
 * transferência de fundos Wallet <-> Stack da mesa (cash game / torneio).
 *
 * IMPORTANTE: qualquer implementação de débito/crédito sobre a wallet
 * deve ser idempotente (chave de idempotência por requisição/webhook)
 * e usar transação de banco com trava (SELECT ... FOR UPDATE ou
 * constraint de saldo não-negativo) para evitar double-spending.
 */
export enum WalletTransactionType {
  PIX_DEPOSIT = 'PIX_DEPOSIT',
  PIX_WITHDRAWAL = 'PIX_WITHDRAWAL',
  TABLE_BUY_IN = 'TABLE_BUY_IN',
  TABLE_CASH_OUT = 'TABLE_CASH_OUT',
  TOURNAMENT_BUY_IN = 'TOURNAMENT_BUY_IN',
  TOURNAMENT_PAYOUT = 'TOURNAMENT_PAYOUT',
  ADJUSTMENT = 'ADJUSTMENT',
}
