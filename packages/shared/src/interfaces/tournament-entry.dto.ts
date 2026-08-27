import { TournamentEntryStatus } from '../enums/tournament-entry-status.enum';
import { MoneyString } from '../types/money';

/**
 * Inscrição de um jogador em um torneio.
 *
 * Note a diferença deliberada de tipos:
 * - `chipStack` é `number` porque são FICHAS de torneio — unidades inteiras
 *   sem valor monetário, que nunca retornam à Wallet.
 * - `prizeAmount` é `MoneyString` porque é dinheiro de verdade, creditado na
 *   Wallet quando a entrada chega a `TournamentEntryStatus.PAID`.
 */
export interface TournamentEntryDto {
  id: string;

  userId: string;

  userName: string;

  status: TournamentEntryStatus;

  /** Fichas de torneio (sem valor monetário). */
  chipStack: number;

  /** Colocação final (1-based); `null` enquanto o jogador não for eliminado. */
  finalPosition: number | null;

  /** Prêmio creditado na Wallet; `null` se não houver premiação. */
  prizeAmount: MoneyString | null;

  /**
   * Mesa e assento correntes — o "ticket" que o caixa entrega ao jogador logo
   * após a inscrição.
   *
   * `null` quando a inscrição ainda não tem assento ativo: torneio sem mesas
   * distribuídas, jogador eliminado (o assento é liberado) ou torneio anterior
   * ao MVP de mesas. Nullable de propósito — não quebra consumidor existente.
   */
  tableNumber: number | null;

  seatNumber: number | null;
}
