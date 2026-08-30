'use client';

import {
  ClubeRole,
  EntryHistoryKind,
  TableSessionStatus,
  TournamentEntryStatus,
  type EntryHistoryItemDto,
} from '@poker-system/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useSession } from '@/components/providers/session-provider';
import { entriesApi } from '@/lib/api/entries';
import {
  Badge,
  Card,
  Dialog,
  EmptyState,
  ErrorState,
  Skeleton,
  type BadgeVariant,
} from '@/components/ui';
import { formatDateTimeSafe, formatMoneySafe } from '@/lib/format';

const KIND_LABEL: Record<EntryHistoryKind, string> = {
  [EntryHistoryKind.TOURNAMENT]: 'Torneio',
  [EntryHistoryKind.TABLE]: 'Mesa',
};

const KIND_BADGE_VARIANT: Record<EntryHistoryKind, BadgeVariant> = {
  [EntryHistoryKind.TOURNAMENT]: 'info',
  [EntryHistoryKind.TABLE]: 'neutral',
};

/**
 * "Valor" da linha — pura escolha de TEXTO/cor sobre campos que o backend já
 * calculou (regra de ouro: dinheiro nunca faz aritmética no frontend, ver
 * `lib/format.ts`). O único ajuste aqui é prefixar `buyIn` (sempre uma
 * magnitude positiva no DTO) com `-` ao exibi-lo como custo — concatenação
 * de string, não conta.
 */
function headlineValue(item: EntryHistoryItemDto): { text: string; danger: boolean } {
  if (item.kind === EntryHistoryKind.TOURNAMENT) {
    if (item.tournamentStatus === TournamentEntryStatus.REFUNDED) {
      return { text: 'Cancelado', danger: false };
    }
    if (item.tournamentStatus === TournamentEntryStatus.PAID && item.prizeAmount) {
      return { text: formatMoneySafe(item.prizeAmount), danger: false };
    }
    return { text: formatMoneySafe(`-${item.buyIn ?? '0'}`), danger: true };
  }

  const suffix = item.tableStatus === TableSessionStatus.ACTIVE ? ' (em andamento)' : '';
  const net = item.netResult ?? '0.00';
  return { text: `${formatMoneySafe(net)}${suffix}`, danger: net.startsWith('-') };
}

function EntryDetail({ item }: { item: EntryHistoryItemDto }) {
  if (item.kind === EntryHistoryKind.TOURNAMENT) {
    return (
      <dl className="flex flex-col gap-2 text-sm">
        <Row label="Torneio" value={item.label} />
        <Row label="Buy-in" value={formatMoneySafe(item.buyIn ?? '—')} />
        <Row label="Status" value={item.tournamentStatus ?? '—'} />
        <Row label="Colocação" value={item.finalPosition ? `${item.finalPosition}º lugar` : '—'} />
        <Row label="Prêmio" value={item.prizeAmount ? formatMoneySafe(item.prizeAmount) : '—'} />
        <Row label="Fichas" value={item.chipStack != null ? String(item.chipStack) : '—'} />
        <Row label="Data" value={formatDateTimeSafe(item.occurredAt)} />
      </dl>
    );
  }

  return (
    <dl className="flex flex-col gap-2 text-sm">
      <Row label="Mesa" value={item.label} />
      <Row label="Status" value={item.tableStatus ?? '—'} />
      <Row label="Buy-in total" value={formatMoneySafe(item.totalBuyIn ?? '—')} />
      <Row label="Cash-out total" value={formatMoneySafe(item.totalCashOut ?? '—')} />
      <Row label="Stack atual" value={formatMoneySafe(item.currentStack ?? '—')} />
      <Row label="Resultado" value={formatMoneySafe(item.netResult ?? '—')} />
      <Row label="Data" value={formatDateTimeSafe(item.occurredAt)} />
    </dl>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="font-ledger text-right font-medium">{value}</dd>
    </div>
  );
}

export function EntryHistoryList() {
  const { clubeRole } = useSession();
  const isAdmin = clubeRole === ClubeRole.ADMIN;
  const [selected, setSelected] = useState<EntryHistoryItemDto | null>(null);

  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: ['entries'],
      queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
        entriesApi.listEntries(pageParam),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    });

  const items = data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Card title="Histórico de entradas">
      {isLoading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState description="Não foi possível carregar o histórico." />
      ) : items.length === 0 ? (
        <EmptyState
          title="Nenhuma entrada ainda"
          description="Suas inscrições em torneio e sessões de mesa aparecem aqui."
        />
      ) : (
        <div className="flex flex-col gap-2">
          <ul className="divide-y divide-border">
            {items.map((item) => {
              const value = headlineValue(item);
              return (
                <li key={`${item.kind}-${item.id}`}>
                  <button
                    type="button"
                    onClick={() => setSelected(item)}
                    className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-left text-sm transition-colors duration-200 hover:bg-surface-hover"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge variant={KIND_BADGE_VARIANT[item.kind]}>
                          {KIND_LABEL[item.kind]}
                        </Badge>
                        <p className="truncate font-medium">{item.label}</p>
                      </div>
                      <p className="text-xs text-muted">
                        {formatDateTimeSafe(item.occurredAt)}
                        {isAdmin ? ` · ${item.userName}` : ''}
                      </p>
                    </div>
                    <span
                      className={
                        value.danger
                          ? 'font-ledger font-semibold text-danger'
                          : 'font-ledger font-semibold text-success'
                      }
                    >
                      {value.text}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {hasNextPage && (
            <button
              type="button"
              onClick={() => void fetchNextPage()}
              disabled={isFetchingNextPage}
              className="self-center text-sm font-medium text-accent transition-colors duration-200 hover:underline disabled:opacity-60"
            >
              {isFetchingNextPage ? 'Carregando...' : 'Carregar mais'}
            </button>
          )}
        </div>
      )}

      <Dialog
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected ? KIND_LABEL[selected.kind] : ''}
      >
        {selected && <EntryDetail item={selected} />}
      </Dialog>
    </Card>
  );
}
