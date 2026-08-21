import { TournamentStatus } from '../enums/tournament-status.enum';
import { MoneyString } from '../types/money';

/**
 * Resumo de um torneio para as listagens do lobby.
 *
 * O débito total da Wallet na inscrição é `buyIn + fee`: `buyIn` compõe o
 * prize pool e `fee` é a receita da casa. Os dois são expostos separados
 * para transparência e o somatório é feito no backend (Decimal).
 */
export interface TournamentSummaryDto {
  id: string;

  name: string;

  /** Parte do valor que vai para o prize pool. */
  buyIn: MoneyString;

  /** Taxa da casa (rake), cobrada junto com o buy-in. */
  fee: MoneyString;

  maxPlayers: number;

  /** Inscritos confirmados (`0 <= registeredPlayers <= maxPlayers`). */
  registeredPlayers: number;

  status: TournamentStatus;

  /** Horário de início em ISO 8601 UTC. */
  startsAt: string;
}
