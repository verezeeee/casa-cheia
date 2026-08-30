'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { tableApi } from '@/lib/api/table';
import { Badge, cn, EmptyState, ErrorState, Reveal, RevealItem, Skeleton } from '@/components/ui';
import { formatMoneySafe } from '@/lib/format';

export function TableList() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['tables'],
    queryFn: () => tableApi.listTables(),
  });

  if (isLoading) {
    return (
      <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2 p-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
        ))}
      </div>
    );
  }
  if (isError || !data) {
    return <ErrorState description="Não foi possível carregar as mesas." />;
  }

  const tables = data.items;
  if (tables.length === 0) {
    return (
      <EmptyState
        title="Nenhuma mesa aberta"
        description="Peça a um administrador para criar uma mesa."
      />
    );
  }

  return (
    <Reveal className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface lg:grid lg:grid-cols-2 lg:gap-3 lg:divide-y-0 lg:overflow-visible lg:rounded-none lg:border-none lg:bg-transparent xl:grid-cols-3">
      {tables.map((table) => (
        <RevealItem key={table.id}>
          <Link
            href={`/tables/${table.id}`}
            className="flex items-start justify-between gap-3 p-4 transition-all duration-200 hover:bg-surface-hover active:scale-[0.99] lg:rounded-lg lg:border lg:border-border lg:bg-surface"
          >
            <div className="min-w-0">
              <p className="font-display font-semibold">{table.name}</p>
              <p className="font-ledger text-sm text-muted">
                Blinds {formatMoneySafe(table.smallBlind)}/{formatMoneySafe(table.bigBlind)} ·
                Buy-in {formatMoneySafe(table.minBuyIn)}–{formatMoneySafe(table.maxBuyIn)}
              </p>
              <div className="mt-1.5 flex items-center gap-2">
                <div className="flex gap-0.5" aria-hidden="true">
                  {Array.from({ length: table.maxSeats }).map((_, i) => (
                    <span
                      key={i}
                      className={cn(
                        'h-1.5 w-1.5 rounded-full',
                        i < table.occupiedSeats ? 'bg-accent' : 'bg-border',
                      )}
                    />
                  ))}
                </div>
                <span className="text-sm text-muted">
                  {table.occupiedSeats}/{table.maxSeats} assentos ocupados
                </span>
              </div>
            </div>
            <Badge variant={table.status === 'OPEN' ? 'success' : 'neutral'}>{table.status}</Badge>
          </Link>
        </RevealItem>
      ))}
    </Reveal>
  );
}
