/**
 * Status da inscrição de um jogador em um torneio.
 *
 * - REGISTERED: buy-in + fee já debitados da Wallet, aguardando o início.
 * - PLAYING: em jogo, com `chipStack` de fichas de torneio. Fichas de torneio
 *   NÃO têm valor monetário e nunca retornam à Wallet — só o prêmio retorna.
 * - ELIMINATED: eliminado. Se estiver na faixa premiada, ainda transita para
 *   PAID quando o payout for creditado.
 * - PAID: prêmio (`prizeAmount`) creditado na Wallet. Estado terminal.
 * - REFUNDED: buy-in + fee estornados na Wallet (torneio cancelado ou
 *   desinscrição durante REGISTERING). Estado terminal.
 */
export enum TournamentEntryStatus {
  REGISTERED = 'REGISTERED',
  PLAYING = 'PLAYING',
  ELIMINATED = 'ELIMINATED',
  PAID = 'PAID',
  REFUNDED = 'REFUNDED',
}
