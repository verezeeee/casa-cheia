import { TournamentStatus } from '../enums/tournament-status.enum';
import { MoneyString } from '../types/money';

/**
 * Resumo de um torneio para as listagens do lobby.
 *
 * O débito total da Wallet na inscrição é `buyIn + fee` (+ `staffBonusCost`
 * se o jogador optar pelo bônus): `buyIn` compõe o prize pool, `fee` é a
 * receita da casa e `staffBonusCost` é a receita da equipe — os três são
 * expostos separados para transparência e o somatório é feito no backend
 * (Decimal).
 */
export interface TournamentSummaryDto {
  id: string;

  name: string;

  /** Parte do valor que vai para o prize pool. */
  buyIn: MoneyString;

  /** Taxa da casa (rake), cobrada junto com o buy-in. */
  fee: MoneyString;

  /**
   * Custo do bônus de staff (staff add-on), OPCIONAL por jogador — bypassa o
   * prize pool como `fee`, mas ninguém é obrigado a pagar. `null` = este
   * torneio não oferece bônus de staff.
   */
  staffBonusCost: MoneyString | null;

  /** Fichas extras concedidas a quem paga o bônus de staff. `null` junto com `staffBonusCost`. */
  staffBonusChips: number | null;

  maxPlayers: number;

  /** Inscritos confirmados (`0 <= registeredPlayers <= maxPlayers`). */
  registeredPlayers: number;

  status: TournamentStatus;

  /** Horário de início em ISO 8601 UTC. */
  startsAt: string;
}
