'use client';

import Link from 'next/link';
import { TournamentStatus } from '@poker-system/shared';
import type { BadgeVariant } from '@/components/ui';
import { useQuery } from '@tanstack/react-query';
import { tournamentApi } from '@/lib/api/tournament';
import { Badge, Card, EmptyState, Spinner } from '@/components/ui';
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

  if (isLoading) return <Spinner size="sm" label="Carregando torneios" />;
  if (isError || !data) {
    return <p className="text-danger">Não foi possível carregar os torneios.</p>;
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
    <ul className="grid gap-4 sm:grid-cols-2">
      {tournaments.map((tournament) => (
        <li key={tournament.id}>
          <Link href={`/tournaments/${tournament.id}`}>
            <Card className="transition-shadow hover:shadow-md">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-display font-semibold">{tournament.name}</p>
                  <p className="font-ledger text-sm text-muted">
                    Buy-in {formatMoneySafe(tournament.buyIn)} + {formatMoneySafe(tournament.fee)}
                  </p>
                </div>
                <Badge variant={STATUS_VARIANT[tournament.status]}>{tournament.status}</Badge>
              </div>
              <p className="mt-2 text-sm text-muted">
                {tournament.registeredPlayers}/{tournament.maxPlayers} inscritos ·{' '}
                {formatDateTimeSafe(tournament.startsAt)}
              </p>
            </Card>
          </Link>
        </li>
      ))}
    </ul>
  );
}
