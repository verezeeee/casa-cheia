/**
 * Motivo pelo qual uma inscrição recebeu determinado assento.
 *
 * - INITIAL: primeira alocação da inscrição (inclui reentry, que também entra
 *   por distribuição inicial sobre o estado corrente do torneio).
 * - BALANCE: movido pelo rebalanceamento entre mesas desiguais.
 * - BREAK: movido porque a mesa de origem foi quebrada.
 * - MANUAL_REDRAW: sorteio manual ordenado pelo diretor do torneio — o único
 *   motivo com ator humano obrigatório.
 *
 * Espelha 1:1 `TournamentSeatReason` do schema Prisma.
 */
export enum TournamentSeatReason {
  INITIAL = 'INITIAL',
  BALANCE = 'BALANCE',
  BREAK = 'BREAK',
  MANUAL_REDRAW = 'MANUAL_REDRAW',
}
