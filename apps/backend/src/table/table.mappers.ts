import type {
  TableSeatDto,
  TableStatus as SharedTableStatus,
  TableSummaryDto,
  TableType as SharedTableType,
} from '@poker-system/shared';
import type { Table } from '../generated/prisma';

const toMoney = (value: { toFixed: (digits: number) => string }): string =>
  value.toFixed(2);

export function toTableSummaryDto(
  table: Table & { _count: { sessions: number } },
): TableSummaryDto {
  return {
    id: table.id,
    name: table.name,
    // Mesmos literais em Prisma e @poker-system/shared (ver base.prisma).
    type: table.type as unknown as SharedTableType,
    smallBlind: toMoney(table.smallBlind),
    bigBlind: toMoney(table.bigBlind),
    minBuyIn: toMoney(table.minBuyIn),
    maxBuyIn: toMoney(table.maxBuyIn),
    maxSeats: table.maxSeats,
    occupiedSeats: table._count.sessions,
    status: table.status as unknown as SharedTableStatus,
  };
}

/** Monta a grade completa de assentos (1..maxSeats), preenchendo os ocupados a partir das sessões ACTIVE. */
export function toTableSeats(
  maxSeats: number,
  activeSessions: Array<{
    id: string;
    seatNumber: number;
    currentStack: { toFixed: (d: number) => string };
    user: { id: string; name: string };
  }>,
): TableSeatDto[] {
  const bySeat = new Map(
    activeSessions.map((session) => [session.seatNumber, session]),
  );

  return Array.from({ length: maxSeats }, (_, index) => {
    const seatNumber = index + 1;
    const occupied = bySeat.get(seatNumber);

    return occupied
      ? {
          seatNumber,
          userId: occupied.user.id,
          userName: occupied.user.name,
          currentStack: toMoney(occupied.currentStack),
          sessionId: occupied.id,
        }
      : {
          seatNumber,
          userId: null,
          userName: null,
          currentStack: null,
          sessionId: null,
        };
  });
}

export function toSeatDto(session: {
  id: string;
  seatNumber: number;
  currentStack: { toFixed: (d: number) => string };
  user: { id: string; name: string };
}): TableSeatDto {
  return {
    seatNumber: session.seatNumber,
    userId: session.user.id,
    userName: session.user.name,
    currentStack: toMoney(session.currentStack),
    sessionId: session.id,
  };
}
