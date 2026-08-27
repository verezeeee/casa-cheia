/**
 * Estado operacional de uma mesa de torneio.
 *
 * - OPEN: mesa em uso, recebe assentos.
 * - CLOSED: mesa quebrada pelo rebalanceamento. Definitivo — não se reabre uma
 *   mesa fechada; abre-se uma nova com outro número, preservando a trilha
 *   histórica dos assentos que ela teve.
 *
 * Deliberadamente distinto de `TableStatus` (cash game), que tem `PAUSED`:
 * mesa de torneio não pausa individualmente — quem pausa é o relógio do
 * torneio inteiro.
 *
 * Espelha 1:1 `TournamentTableStatus` do schema Prisma.
 */
export enum TournamentTableStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
}
