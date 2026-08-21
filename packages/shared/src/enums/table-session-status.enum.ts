/**
 * Status da sessão de um jogador em uma mesa de cash game (assento ocupado).
 *
 * - ACTIVE: o jogador está sentado e seu `currentStack` vive na mesa, fora da
 *   Wallet. Os dois saldos são separados por construção: o buy-in debita a
 *   Wallet e credita o stack, e nada além do cash-out faz o caminho inverso.
 * - CASHED_OUT: sessão encerrada; o stack final foi creditado de volta na
 *   Wallet em uma única transação atômica (zera o stack + credita a Wallet).
 *   Estado terminal — uma sessão CASHED_OUT nunca volta para ACTIVE.
 */
export enum TableSessionStatus {
  ACTIVE = 'ACTIVE',
  CASHED_OUT = 'CASHED_OUT',
}
