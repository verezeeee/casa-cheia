import type {
  TableCloseReportItemDto,
  TableSeatDto,
  TableStatus as SharedTableStatus,
  TableSummaryDto,
  TableType as SharedTableType,
} from '@poker-system/shared';
import { Prisma } from '../generated/prisma';
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

/**
 * Agrega `TableSession`s da mesma mesa POR JOGADOR — um jogador pode ter
 * mais de uma sessão na mesma mesa (cash-out e rebuy voltando a sentar
 * depois; não há `@@unique` bloqueando isso, ver `table.prisma`), então
 * somar por `userId` evita duplicar a linha dele no relatório de fechamento.
 */
export function toTableCloseReport(
  sessions: Array<{
    userId: string;
    totalBuyIn: Prisma.Decimal;
    totalCashOut: Prisma.Decimal;
    currentStack: Prisma.Decimal;
    user: { name: string };
  }>,
): TableCloseReportItemDto[] {
  const byUser = new Map<
    string,
    {
      userName: string;
      totalBuyIn: Prisma.Decimal;
      totalCashOut: Prisma.Decimal;
      currentStack: Prisma.Decimal;
    }
  >();

  for (const session of sessions) {
    const acc = byUser.get(session.userId) ?? {
      userName: session.user.name,
      totalBuyIn: new Prisma.Decimal(0),
      totalCashOut: new Prisma.Decimal(0),
      currentStack: new Prisma.Decimal(0),
    };
    acc.totalBuyIn = acc.totalBuyIn.plus(session.totalBuyIn);
    acc.totalCashOut = acc.totalCashOut.plus(session.totalCashOut);
    acc.currentStack = acc.currentStack.plus(session.currentStack);
    byUser.set(session.userId, acc);
  }

  return Array.from(byUser.entries())
    .map(([userId, acc]) => ({
      userId,
      userName: acc.userName,
      totalBuyIn: toMoney(acc.totalBuyIn),
      totalCashOut: toMoney(acc.totalCashOut),
      currentStack: toMoney(acc.currentStack),
      // Mesma fórmula de `EntriesService` (`totalCashOut + currentStack - totalBuyIn`).
      netResult: toMoney(
        acc.totalCashOut.plus(acc.currentStack).minus(acc.totalBuyIn),
      ),
    }))
    .sort((a, b) => a.userName.localeCompare(b.userName));
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
