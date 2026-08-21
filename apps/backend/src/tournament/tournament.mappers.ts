import type {
  TournamentDetailResponse,
  TournamentEntryDto,
  TournamentEntryStatus as SharedTournamentEntryStatus,
  TournamentPrizeDto,
  TournamentStatus as SharedTournamentStatus,
  TournamentSummaryDto,
} from '@poker-system/shared';
import type {
  Tournament,
  TournamentEntry,
  TournamentPrize,
} from '@prisma/client';

const toMoney = (value: { toFixed: (digits: number) => string }): string =>
  value.toFixed(2);

export function toTournamentSummaryDto(
  tournament: Tournament & { _count: { entries: number } },
): TournamentSummaryDto {
  return {
    id: tournament.id,
    name: tournament.name,
    buyIn: toMoney(tournament.buyIn),
    fee: toMoney(tournament.fee),
    maxPlayers: tournament.maxPlayers,
    registeredPlayers: tournament._count.entries,
    // Mesmos literais em Prisma e @poker-system/shared (ver base.prisma).
    status: tournament.status as unknown as SharedTournamentStatus,
    startsAt: tournament.startsAt.toISOString(),
  };
}

export function toTournamentEntryDto(
  entry: TournamentEntry & { user: { name: string } },
): TournamentEntryDto {
  return {
    id: entry.id,
    userId: entry.userId,
    userName: entry.user.name,
    status: entry.status as unknown as SharedTournamentEntryStatus,
    chipStack: entry.chipStack,
    finalPosition: entry.finalPosition,
    prizeAmount: entry.prizeAmount ? toMoney(entry.prizeAmount) : null,
  };
}

function toTournamentPrizeDto(prize: TournamentPrize): TournamentPrizeDto {
  return { position: prize.position, percentage: toMoney(prize.percentage) };
}

export function toTournamentDetailResponse(
  tournament: Tournament & { _count: { entries: number } },
  prizes: TournamentPrize[],
  entries: Array<TournamentEntry & { user: { name: string } }>,
): TournamentDetailResponse {
  return {
    ...toTournamentSummaryDto(tournament),
    prizes: prizes.map(toTournamentPrizeDto),
    entries: entries.map(toTournamentEntryDto),
  };
}
