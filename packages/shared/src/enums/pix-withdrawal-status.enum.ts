/**
 * Status de um saque PIX (cash-out) solicitado pelo jogador.
 *
 * - REQUESTED: solicitação aceita. O valor JÁ foi debitado e reservado da
 *   Wallet neste momento (débito antecipado), evitando que o mesmo saldo seja
 *   gasto em uma mesa enquanto o saque é processado (double-spending).
 * - PROCESSING: enviado ao PSP, aguardando liquidação.
 * - COMPLETED: liquidado com sucesso. Estado terminal.
 * - FAILED: recusado/estornado pelo PSP. Exige lançamento compensatório na
 *   Wallet (WalletTransactionStatus.REVERSED) para devolver o valor reservado.
 */
export enum PixWithdrawalStatus {
  REQUESTED = 'REQUESTED',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}
