import type {
  PublicTournamentTableMapDto,
  TournamentClockDto,
  TournamentClockStatus as SharedTournamentClockStatus,
  TournamentDetailResponse,
  TournamentEntryDto,
  TournamentEntryStatus as SharedTournamentEntryStatus,
  TournamentPrizeDto,
  TournamentStatus as SharedTournamentStatus,
  TournamentSummaryDto,
  TournamentTableMapDto,
  TournamentTableStatus as SharedTournamentTableStatus,
} from '@poker-system/shared';
import type {
  Tournament,
  TournamentBlindLevel,
  TournamentClockStatus,
  TournamentEntry,
  TournamentPrize,
  TournamentTableStatus,
} from '@prisma/client';
import { toBlindLevelDto } from './blind-structure.mappers';

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

/**
 * Assentos incluídos na consulta da inscrição. Opcional: quem não faz o
 * `include` recebe `tableNumber`/`seatNumber` nulos, e não um ticket errado.
 * Espera-se APENAS o assento ativo (`where: { active: true }`) — a tabela é
 * append-only e carrega todo o histórico de movimentações.
 */
type EntrySeatInclude = {
  seats?: Array<{
    seatNumber: number;
    tournamentTable: { tableNumber: number };
  }>;
};

export function toTournamentEntryDto(
  entry: TournamentEntry & { user: { name: string } } & EntrySeatInclude,
): TournamentEntryDto {
  const activeSeat = entry.seats?.[0] ?? null;

  return {
    id: entry.id,
    userId: entry.userId,
    userName: entry.user.name,
    status: entry.status as unknown as SharedTournamentEntryStatus,
    chipStack: entry.chipStack,
    finalPosition: entry.finalPosition,
    prizeAmount: entry.prizeAmount ? toMoney(entry.prizeAmount) : null,
    tableNumber: activeSeat?.tournamentTable.tableNumber ?? null,
    seatNumber: activeSeat?.seatNumber ?? null,
  };
}

/**
 * Só os campos de valor do nível — serve tanto para `TournamentBlindLevel`
 * (a cópia que o relógio consome) quanto para o `BlindLevel` do preset.
 */
export type BlindLevelRow = Pick<
  TournamentBlindLevel,
  | 'levelNumber'
  | 'smallBlind'
  | 'bigBlind'
  | 'ante'
  | 'durationSeconds'
  | 'isBreak'
  | 'breakLabel'
>;

/** Colunas de relógio do `Tournament` (ver a invariante em tournament.prisma). */
export type TournamentClockView = {
  clockStatus: TournamentClockStatus;
  currentLevelNumber: number | null;
  levelEndsAt: Date | null;
  clockRemainingMs: number | null;
};

/**
 * Projeta o estado do relógio para quem exibe. `remainingMs` é SEMPRE derivado
 * aqui, no servidor: em `RUNNING` a partir de `levelEndsAt`, em `PAUSED` do
 * valor congelado, e `0` nos estados sem contagem. `now` é o mesmo instante
 * devolvido em `serverTime`, para o cliente corrigir a deriva do relógio dele.
 */
export function toTournamentClockDto(
  clock: TournamentClockView,
  levels: BlindLevelRow[],
  now: Date,
): TournamentClockDto {
  const index = levels.findIndex(
    (level) => level.levelNumber === clock.currentLevelNumber,
  );
  const currentLevel = index === -1 ? null : levels[index];
  const nextLevel = index === -1 ? null : (levels[index + 1] ?? null);

  let remainingMs = 0;
  if (clock.clockStatus === 'RUNNING' && clock.levelEndsAt) {
    remainingMs = Math.max(0, clock.levelEndsAt.getTime() - now.getTime());
  } else if (clock.clockStatus === 'PAUSED') {
    remainingMs = Math.max(0, clock.clockRemainingMs ?? 0);
  }

  return {
    // Mesmos literais em Prisma e @poker-system/shared (ver base.prisma).
    clockStatus: clock.clockStatus as unknown as SharedTournamentClockStatus,
    currentLevel: currentLevel ? toBlindLevelDto(currentLevel) : null,
    nextLevel: nextLevel ? toBlindLevelDto(nextLevel) : null,
    levelEndsAt:
      clock.clockStatus === 'RUNNING' && clock.levelEndsAt
        ? clock.levelEndsAt.toISOString()
        : null,
    remainingMs,
    serverTime: now.toISOString(),
  };
}

/**
 * Mesa como o mapa precisa dela: só os assentos ATIVOS, cada um com a
 * inscrição sentada. É o shape de `TournamentService.readTableMap` — o
 * `include` vive lá porque quem monta a query é quem sabe se está dentro de
 * uma transação.
 */
export type TournamentTableRow = {
  id: string;
  tableNumber: number;
  capacity: number;
  status: TournamentTableStatus;
  seats: Array<{
    seatNumber: number;
    tournamentEntry: {
      id: string;
      userId: string;
      chipStack: number;
      user: { name: string };
    };
  }>;
};

/**
 * Mapa de mesas (MT-BE-06, e depois a tela de staff/TV de MT-BE-08).
 * `playersRemaining` sai da contagem de assentos ATIVOS, não de
 * `TournamentEntry.status`: são a mesma coisa quando as invariantes valem, e
 * discordar delas é exatamente o que o teste precisa flagrar.
 */
export function toTournamentTableMapDto(
  tournamentId: string,
  tables: TournamentTableRow[],
): TournamentTableMapDto {
  const seats = tables.flatMap((table) => table.seats);
  const totalChips = seats.reduce(
    (total, seat) => total + seat.tournamentEntry.chipStack,
    0,
  );

  return {
    tournamentId,
    tables: tables.map((table) => ({
      id: table.id,
      tableNumber: table.tableNumber,
      capacity: table.capacity,
      // Mesmos literais em Prisma e @poker-system/shared (ver base.prisma).
      status: table.status as unknown as SharedTournamentTableStatus,
      seats: [...table.seats]
        .sort((a, b) => a.seatNumber - b.seatNumber)
        .map((seat) => ({
          entryId: seat.tournamentEntry.id,
          userId: seat.tournamentEntry.userId,
          userName: seat.tournamentEntry.user.name,
          seatNumber: seat.seatNumber,
          chipStack: seat.tournamentEntry.chipStack,
        })),
    })),
    playersRemaining: seats.length,
    averageStack:
      seats.length === 0 ? 0 : Math.round(totalChips / seats.length),
  };
}

/**
 * Mapa PÚBLICO (MT-BE-08): o mesmo de `toTournamentTableMapDto`, sem `userId`.
 *
 * Cada assento é remontado por LISTA DE PERMISSÃO (`entryId`, `userName`,
 * `seatNumber`, `chipStack`) e não por `delete`/rest-spread: numa rota sem
 * autenticação, um campo novo em `TournamentSeatDto` tem que precisar de uma
 * linha aqui para vazar, e não vazar por omissão.
 */
export function toPublicTournamentTableMapDto(
  tournamentId: string,
  tables: TournamentTableRow[],
): PublicTournamentTableMapDto {
  const map = toTournamentTableMapDto(tournamentId, tables);

  return {
    ...map,
    tables: map.tables.map((table) => ({
      ...table,
      seats: table.seats.map((seat) => ({
        entryId: seat.entryId,
        userName: seat.userName,
        seatNumber: seat.seatNumber,
        chipStack: seat.chipStack,
      })),
    })),
  };
}

function toTournamentPrizeDto(prize: TournamentPrize): TournamentPrizeDto {
  return { position: prize.position, percentage: toMoney(prize.percentage) };
}

export function toTournamentDetailResponse(
  tournament: Tournament & { _count: { entries: number } },
  prizes: TournamentPrize[],
  entries: Array<
    TournamentEntry & { user: { name: string } } & EntrySeatInclude
  >,
): TournamentDetailResponse {
  return {
    ...toTournamentSummaryDto(tournament),
    prizes: prizes.map(toTournamentPrizeDto),
    entries: entries.map(toTournamentEntryDto),
  };
}
