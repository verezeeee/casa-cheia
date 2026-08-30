'use client';

import Link from 'next/link';
import { TournamentStatus } from '@poker-system/shared';
import type { BadgeVariant } from '@/components/ui';
import { useQuery } from '@tanstack/react-query';
import { tournamentApi } from '@/lib/api/tournament';
import { Badge, EmptyState, ErrorState, Reveal, RevealItem, Skeleton } from '@/components/ui';
import { formatDateTimeSafe, formatMoneySafe } from '@/lib/format';

const STATUS_VARIANT: Record<TournamentStatus, BadgeVariant> = {
  [TournamentStatus.DRAFT]: 'warning',
  [TournamentStatus.REGISTERING]: 'success',
  [TournamentStatus.RUNNING]: 'info',
  [TournamentStatus.FINISHED]: 'neutral',
  [TournamentStatus.CANCELLED]: 'danger',
};

export function TournamentList() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['tournaments'],
    queryFn: () => tournamentApi.listTournaments(),
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
    return <ErrorState description="Não foi possível carregar os torneios." />;
  }

  const tournaments = data.items;
  if (tournaments.length === 0) {
    return (
      <EmptyState
        title="Nenhum torneio aberto"
        description="Peça a um administrador para criar um torneio."
      />
    );
  }

  return (
    <Reveal className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface lg:grid lg:grid-cols-2 lg:gap-3 lg:divide-y-0 lg:overflow-visible lg:rounded-none lg:border-none lg:bg-transparent xl:grid-cols-3">
      {tournaments.map((tournament) => (
        <RevealItem key={tournament.id}>
          <Link
            href={`/tournaments/${tournament.id}`}
            className="flex items-start justify-between gap-3 p-4 transition-all duration-200 hover:bg-surface-hover active:scale-[0.99] lg:rounded-lg lg:border lg:border-border lg:bg-surface"
          >
            <div className="min-w-0">
              <p className="font-display font-semibold">{tournament.name}</p>
              <p className="font-ledger text-sm text-muted">
                Buy-in {formatMoneySafe(tournament.buyIn)} + {formatMoneySafe(tournament.fee)}
              </p>
              <p className="mt-1.5 text-sm text-muted">
                {tournament.registeredPlayers}/{tournament.maxPlayers} inscritos ·{' '}
                {formatDateTimeSafe(tournament.startsAt)}
              </p>
            </div>
            <Badge variant={STATUS_VARIANT[tournament.status]}>{tournament.status}</Badge>
          </Link>
        </RevealItem>
      ))}
    </Reveal>
  );
}
