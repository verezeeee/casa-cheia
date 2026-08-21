/**
 * Ciclo de vida de um torneio.
 *
 * - DRAFT: em configuração pelo backoffice, invisível para os jogadores.
 * - REGISTERING: inscrições abertas. Cada inscrição debita buy-in + fee da
 *   Wallet e passa a compor o prize pool.
 * - RUNNING: torneio em andamento; inscrições encerradas (salvo late reg).
 * - FINISHED: premiação distribuída. Estado terminal.
 * - CANCELLED: cancelado; TODAS as inscrições devem ser reembolsadas
 *   (TournamentEntryStatus.REFUNDED) antes de o torneio ficar neste estado.
 */
export enum TournamentStatus {
  DRAFT = 'DRAFT',
  REGISTERING = 'REGISTERING',
  RUNNING = 'RUNNING',
  FINISHED = 'FINISHED',
  CANCELLED = 'CANCELLED',
}
