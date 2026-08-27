import { TournamentSeatDto } from './tournament-seat.dto';
import { TournamentTableDto } from './tournament-table.dto';

/**
 * Mapa completo de mesas do torneio — payload da tela de staff e da TV.
 *
 * INVARIANTE do rebalanceamento, verificável direto neste payload: entre as
 * mesas `OPEN`, `max(seats.length) - min(seats.length) <= 1`.
 */
export interface TournamentTableMapDto {
  tournamentId: string;

  /** Mesas em ordem de `tableNumber`. */
  tables: TournamentTableDto[];

  /** Jogadores ainda vivos no torneio (soma dos assentos ativos). */
  playersRemaining: number;

  /** Stack médio em FICHAS (total de fichas / `playersRemaining`). */
  averageStack: number;
}

/**
 * O MESMO mapa, como sai do endpoint PÚBLICO de TV (MT-BE-08): sem `userId`.
 *
 * Nome e assento estão na TV do salão de qualquer forma; `userId` é chave de
 * usuário e não tem nada que aparecer numa rota sem autenticação. O tipo é
 * derivado (e não copiado) de propósito: campo novo em `TournamentSeatDto`
 * aparece aqui, e a decisão de expor ou não é tomada no mapper, que monta o
 * assento público por lista de permissão.
 */
export type PublicTournamentSeatDto = Omit<TournamentSeatDto, 'userId'>;

export type PublicTournamentTableDto = Omit<TournamentTableDto, 'seats'> & {
  seats: PublicTournamentSeatDto[];
};

export type PublicTournamentTableMapDto = Omit<TournamentTableMapDto, 'tables'> & {
  tables: PublicTournamentTableDto[];
};
