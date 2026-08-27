import { TournamentTableStatus } from '../enums/tournament-table-status.enum';
import { TournamentSeatDto } from './tournament-seat.dto';

/** Uma mesa do torneio com sua ocupação corrente. */
export interface TournamentTableDto {
  id: string;

  /** Número exibido ao jogador ("Mesa 3"), estável durante todo o torneio. */
  tableNumber: number;

  capacity: number;

  status: TournamentTableStatus;

  /**
   * Apenas os assentos OCUPADOS, em ordem de `seatNumber`. Uma mesa `CLOSED`
   * tem sempre `seats` vazio — ninguém pode continuar sentado nela.
   */
  seats: TournamentSeatDto[];
}
