/**
 * Estado do relógio de blinds de um torneio.
 *
 * - NOT_STARTED: torneio criado, relógio nunca iniciado.
 * - RUNNING: nível corrente correndo. `levelEndsAt` está preenchido e o tempo
 *   restante é derivado do relógio do SERVIDOR — nunca do dispositivo que
 *   exibe (ver `serverTime` em `TournamentClockDto`).
 * - PAUSED: relógio congelado; o restante do nível foi preservado.
 * - FINISHED: último nível concluído. Estado terminal.
 *
 * Espelha 1:1 (mesmos literais, mesma ordem) `TournamentClockStatus` do schema
 * Prisma.
 */
export enum TournamentClockStatus {
  NOT_STARTED = 'NOT_STARTED',
  RUNNING = 'RUNNING',
  PAUSED = 'PAUSED',
  FINISHED = 'FINISHED',
}
