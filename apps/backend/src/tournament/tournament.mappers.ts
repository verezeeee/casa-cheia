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
} from '../generated/prisma';
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
    staffBonusCost: tournament.staffBonusCost
      ? toMoney(tournament.staffBonusCost)
      : null,
    staffBonusChips: tournament.staffBonusChips,
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
    staffBonusPaid: entry.staffBonusPaid,
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
 * "Anda" o relógio pelo tempo de parede que passou desde a última escrita —
 * é isto que faz o nível (e os segundos) avançarem SOZINHOS, sem depender de
 * alguém clicar em "Próximo nível" (`tournament-clock.service.ts`).
 *
 * PURA: não escreve nada, só recalcula. Cada `levelEndsAt` seguinte nasce do
 * `levelEndsAt` ANTERIOR + a duração do próximo nível — nunca `now +
 * duração` — porque isso é o que mantém o resultado correto mesmo pulando
 * vários níveis de uma vez (ex.: ninguém abriu a TV por 40 minutos): o fim de
 * cada nível cai exatamente onde cairia se o relógio tivesse avançado nível a
 * nível em tempo real, sem acumular deriva.
 *
 * Fora de `RUNNING` (ou sem `levelEndsAt`) é NO-OP: `PAUSED`/`NOT_STARTED`/
 * `FINISHED` não andam com o relógio de parede, e é assim que já deveria ser.
 *
 * Usada nos dois pontos que precisam do nível FISICAMENTE correto agora, não
 * do que estiver gravado: a leitura do relógio (`TournamentClockService.read`
 * / `mutate`) e a checagem de corte de reentrada
 * (`TournamentService.registerEntry`, que lê `currentLevelNumber` para
 * comparar com `reentryUntilLevel` — sem isto, uma reentrada tardia poderia
 * escapar do corte só porque ninguém tinha mexido no relógio recentemente).
 */
export function advanceClockToNow(
  clock: TournamentClockView,
  levels: BlindLevelRow[],
  now: Date,
): TournamentClockView {
  if (clock.clockStatus !== 'RUNNING' || !clock.levelEndsAt) return clock;

  const sorted = [...levels].sort((a, b) => a.levelNumber - b.levelNumber);
  let index = sorted.findIndex(
    (level) => level.levelNumber === clock.currentLevelNumber,
  );
  if (index === -1) return clock;

  // Estritamente MENOR: no instante exato em que um nível termina, ele ainda
  // é o nível corrente (com 0 restante, já clampado em `toTournamentClockDto`)
  // — só rola pro próximo depois que o tempo passa de verdade. Com `<=` no
  // lugar de `<`, ficar exatamente na borda entre dois níveis os pularia os
  // dois de uma vez (e um `next()` chamado bem nessa borda avançaria dois
  // níveis em vez de um).
  let levelEndsAt = clock.levelEndsAt;
  while (levelEndsAt.getTime() < now.getTime()) {
    const next = sorted[index + 1];
    if (!next) {
      return {
        clockStatus: 'FINISHED',
        currentLevelNumber: sorted[index].levelNumber,
        levelEndsAt: null,
        clockRemainingMs: null,
      };
    }
    index += 1;
    levelEndsAt = new Date(levelEndsAt.getTime() + next.durationSeconds * 1000);
  }

  return {
    clockStatus: 'RUNNING',
    currentLevelNumber: sorted[index].levelNumber,
    levelEndsAt,
    clockRemainingMs: null,
  };
}

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
    startingStack: tournament.startingStack,
    tableCapacity: tournament.tableCapacity,
    lateRegUntil: tournament.lateRegUntil?.toISOString() ?? null,
    guaranteedPrize: tournament.guaranteedPrize
      ? toMoney(tournament.guaranteedPrize)
      : null,
    blindStructureId: tournament.blindStructureId,
    allowReentry: tournament.allowReentry,
    maxReentries: tournament.maxReentries,
    reentryUntilLevel: tournament.reentryUntilLevel,
    prizes: prizes.map(toTournamentPrizeDto),
    entries: entries.map(toTournamentEntryDto),
  };
}
