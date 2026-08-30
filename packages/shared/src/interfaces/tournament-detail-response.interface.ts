import { TournamentEntryDto } from './tournament-entry.dto';
import { TournamentSummaryDto } from './tournament-summary.dto';
import { MoneyString } from '../types/money';

/** Uma faixa da grade de premiação (ver `TournamentPrize` em tournament.prisma). */
export interface TournamentPrizeDto {
  /** Colocação premiada: 1 = campeão, 2 = vice, e assim por diante. */
  position: number;

  /** Percentual do prize pool desta colocação, decimal como string (ex.: "40.00" = 40%). */
  percentage: string;
}

/**
 * Detalhe completo de um torneio: resumo + grade de premiação + inscritos +
 * os campos de configuração que `TournamentSummaryDto` não expõe (a listagem
 * do lobby fica leve de propósito). Usado pela tela de detalhe/inscrição e
 * pelo formulário de edição (`PATCH .../torneios/:id`), que precisa de TODO
 * campo configurável para pré-preencher.
 */
export interface TournamentDetailResponse extends TournamentSummaryDto {
  startingStack: number;

  tableCapacity: number;

  /** ISO 8601 UTC; `null` = sem late registration. */
  lateRegUntil: string | null;

  guaranteedPrize: MoneyString | null;

  /** Preset de blinds que originou a grade deste torneio; `null` = torneio sem preset (níveis podem existir mesmo assim, avulsos). */
  blindStructureId: string | null;

  allowReentry: boolean;

  maxReentries: number | null;

  reentryUntilLevel: number | null;

  prizes: TournamentPrizeDto[];
  entries: TournamentEntryDto[];
}
