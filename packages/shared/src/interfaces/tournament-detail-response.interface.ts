import { TournamentEntryDto } from './tournament-entry.dto';
import { TournamentSummaryDto } from './tournament-summary.dto';

/** Uma faixa da grade de premiação (ver `TournamentPrize` em tournament.prisma). */
export interface TournamentPrizeDto {
  /** Colocação premiada: 1 = campeão, 2 = vice, e assim por diante. */
  position: number;

  /** Percentual do prize pool desta colocação, decimal como string (ex.: "40.00" = 40%). */
  percentage: string;
}

/**
 * Detalhe completo de um torneio: resumo + grade de premiação + inscritos.
 * Usado pela tela de detalhe/inscrição — as listagens do lobby usam apenas
 * `TournamentSummaryDto`, mais leve.
 */
export interface TournamentDetailResponse extends TournamentSummaryDto {
  prizes: TournamentPrizeDto[];
  entries: TournamentEntryDto[];
}
