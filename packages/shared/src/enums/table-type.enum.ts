/**
 * Distingue os dois contextos de fundos em jogo:
 * - CASH_GAME: o stack na mesa é convertido a partir da Wallet no buy-in
 *   e devolvido à Wallet no cash-out, a qualquer momento.
 * - TOURNAMENT: o buy-in é debitado da Wallet uma única vez; o "stack"
 *   de torneio não é convertido de volta — apenas o payout final retorna
 *   à Wallet, conforme colocação.
 */
export enum TableType {
  CASH_GAME = 'CASH_GAME',
  TOURNAMENT = 'TOURNAMENT',
}
