'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { tableApi } from '@/lib/api/table';
import { Badge, Card, EmptyState, Spinner } from '@/components/ui';
import { formatMoneySafe } from '@/lib/format';

export function TableList() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['tables'],
    queryFn: () => tableApi.listTables(),
  });

  if (isLoading) return <Spinner size="sm" label="Carregando mesas" />;
  if (isError || !data) {
    return <p className="text-red-600 dark:text-red-400">Não foi possível carregar as mesas.</p>;
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
    <ul className="grid gap-4 sm:grid-cols-2">
      {tables.map((table) => (
        <li key={table.id}>
          <Link href={`/tables/${table.id}`}>
            <Card className="transition-shadow hover:shadow-md">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{table.name}</p>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    Blinds {formatMoneySafe(table.smallBlind)}/{formatMoneySafe(table.bigBlind)} ·
                    Buy-in {formatMoneySafe(table.minBuyIn)}–{formatMoneySafe(table.maxBuyIn)}
                  </p>
                </div>
                <Badge variant={table.status === 'OPEN' ? 'success' : 'neutral'}>
                  {table.status}
                </Badge>
              </div>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                {table.occupiedSeats}/{table.maxSeats} assentos ocupados
              </p>
            </Card>
          </Link>
        </li>
      ))}
    </ul>
  );
}
