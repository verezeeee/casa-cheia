import { Injectable } from '@nestjs/common';
import {
  EntryHistoryKind,
  type EntryHistoryItemDto,
  type PaginatedResponse,
} from '@poker-system/shared';
import { Prisma } from '@prisma/client';
import { decodeCursor, encodeCursor } from '../common/pagination/cursor';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_PAGE_SIZE = 20;

/**
 * Teto de linhas buscadas POR FONTE (torneio, mesa) a cada página — não é
 * um limite de resultado, é um buffer de merge (ver `listEntries`).
 *
 * ponytail: assume que nenhum usuário/clube tem mais de 500 inscrições de
 * torneio OU sessões de mesa mais NOVAS que o cursor da página (o filtro de
 * cursor já corta tudo que é mais antigo — isso não é "total histórico",
 * é só a janela entre a página anterior e agora). Se algum dia isso não
 * bastar, meio caminho é uma UNION SQL com keyset sobre o resultado
 * combinado; ver contexto no plano desta feature.
 */
const SOURCE_FETCH_CAP = 500;

type RawTournamentRow = {
  id: string;
  userId: string;
  registeredAt: Date;
  status: string;
  finalPosition: number | null;
  prizeAmount: { toFixed(n: number): string } | null;
  chipStack: number;
  user: { name: string };
  tournament: { name: string; buyIn: { toFixed(n: number): string } };
};

type RawTableRow = {
  id: string;
  userId: string;
  joinedAt: Date;
  status: string;
  totalBuyIn: Prisma.Decimal;
  totalCashOut: Prisma.Decimal;
  currentStack: Prisma.Decimal;
  user: { name: string };
  table: { name: string };
};

function toTournamentItem(row: RawTournamentRow): EntryHistoryItemDto {
  return {
    kind: EntryHistoryKind.TOURNAMENT,
    id: row.id,
    occurredAt: row.registeredAt.toISOString(),
    userId: row.userId,
    userName: row.user.name,
    label: row.tournament.name,
    buyIn: row.tournament.buyIn.toFixed(2),
    tournamentStatus: row.status as EntryHistoryItemDto['tournamentStatus'],
    finalPosition: row.finalPosition,
    prizeAmount: row.prizeAmount?.toFixed(2) ?? null,
    chipStack: row.chipStack,
    totalBuyIn: null,
    totalCashOut: null,
    currentStack: null,
    tableStatus: null,
    netResult: null,
  };
}

function toTableItem(row: RawTableRow): EntryHistoryItemDto {
  // Mesma fórmula do docblock de `TableSession.totalCashOut` no schema —
  // `currentStack` é sempre 0 em `CASHED_OUT`, então isto já é o resultado
  // final ali; em `ACTIVE` é o resultado corrente (dinheiro ainda na mesa).
  const netResult = row.totalCashOut
    .plus(row.currentStack)
    .minus(row.totalBuyIn);

  return {
    kind: EntryHistoryKind.TABLE,
    id: row.id,
    occurredAt: row.joinedAt.toISOString(),
    userId: row.userId,
    userName: row.user.name,
    label: row.table.name,
    buyIn: null,
    tournamentStatus: null,
    finalPosition: null,
    prizeAmount: null,
    chipStack: null,
    totalBuyIn: row.totalBuyIn.toFixed(2),
    totalCashOut: row.totalCashOut.toFixed(2),
    currentStack: row.currentStack.toFixed(2),
    netResult: netResult.toFixed(2),
    tableStatus: row.status as EntryHistoryItemDto['tableStatus'],
  };
}

@Injectable()
export class EntriesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Histórico unificado de participação — inscrições de torneio + sessões
   * de mesa, numa lista só ordenada por data. `userId: null` significa
   * "o clube inteiro" (decisão do ADMIN, tomada no controller via
   * `@CurrentClube()`); qualquer outro valor escopa para aquele jogador.
   *
   * MERGE EM MEMÓRIA, NÃO UNION SQL: busca até `SOURCE_FETCH_CAP` linhas de
   * CADA fonte (já filtradas pelo cursor — nunca reprocessa o que já foi
   * servido), concatena, reordena por `occurredAt` e corta em `limit`. Mais
   * simples que uma UNION com keyset sobre duas tabelas heterogêneas, e o
   * volume real de um clube não chega perto do teto — ver docblock de
   * `SOURCE_FETCH_CAP`.
   *
   * CURSOR: reaproveita o `encodeCursor`/`decodeCursor` genérico de
   * `common/pagination/cursor.ts` (o mesmo de `WalletService.getTransactions`)
   * — funciona igual aqui porque as duas fontes convertem seu campo de data
   * (`registeredAt`/`joinedAt`) para o `createdAt` do cursor na hora de
   * montar o `where`, sem precisar generalizar o utilitário.
   */
  async listEntries(
    clubeId: string,
    userId: string | null,
    cursor: string | undefined,
    limit: number | undefined,
  ): Promise<PaginatedResponse<EntryHistoryItemDto>> {
    const pageSize = limit ?? DEFAULT_PAGE_SIZE;
    const after = cursor ? decodeCursor(cursor) : null;

    const [tournamentRows, tableRows] = await Promise.all([
      this.prisma.tournamentEntry.findMany({
        where: {
          clubeId,
          ...(userId ? { userId } : {}),
          ...(after
            ? {
                OR: [
                  { registeredAt: { lt: after.createdAt } },
                  { registeredAt: after.createdAt, id: { lt: after.id } },
                ],
              }
            : {}),
        },
        include: {
          user: { select: { name: true } },
          tournament: { select: { name: true, buyIn: true } },
        },
        orderBy: [{ registeredAt: 'desc' }, { id: 'desc' }],
        take: SOURCE_FETCH_CAP,
      }),
      this.prisma.tableSession.findMany({
        where: {
          clubeId,
          ...(userId ? { userId } : {}),
          ...(after
            ? {
                OR: [
                  { joinedAt: { lt: after.createdAt } },
                  { joinedAt: after.createdAt, id: { lt: after.id } },
                ],
              }
            : {}),
        },
        include: {
          user: { select: { name: true } },
          table: { select: { name: true } },
        },
        orderBy: [{ joinedAt: 'desc' }, { id: 'desc' }],
        take: SOURCE_FETCH_CAP,
      }),
    ]);

    const combined = [
      ...tournamentRows.map(toTournamentItem),
      ...tableRows.map(toTableItem),
    ].sort((a, b) => {
      const diff =
        new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime();
      return diff !== 0 ? diff : b.id.localeCompare(a.id);
    });

    const hasMore = combined.length > pageSize;
    const page = hasMore ? combined.slice(0, pageSize) : combined;
    const last = page[page.length - 1];

    return {
      items: page,
      nextCursor:
        hasMore && last
          ? encodeCursor({ createdAt: new Date(last.occurredAt), id: last.id })
          : null,
    };
  }
}
