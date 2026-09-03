'use client';

import { ClubeRole, TournamentStatus } from '@poker-system/shared';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/components/providers/session-provider';
import { tournamentApi } from '@/lib/api/tournament';
import {
  Badge,
  EmptyState,
  ErrorState,
  Reveal,
  RevealItem,
  Skeleton,
  TextLink,
} from '@/components/ui';
import { formatDateTimeSafe, formatMoneySafe } from '@/lib/format';
import { TOURNAMENT_STATUS_VARIANT } from '@/lib/tournament-status';

export function TournamentList() {
  const { clubeRole } = useSession();
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

  // Só ADMIN, mesma guarda do endpoint (`RT-003`).
  const isAdmin = clubeRole === ClubeRole.ADMIN;
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
          {/* O card deixou de ser um único `<Link>` porque o atalho de
              relatório é um segundo destino: âncora dentro de âncora é HTML
              inválido (e o clique interno viraria navegação para o detalhe).
              O wrapper herdou a moldura de `lg:`; o padding e o hover
              continuam no link principal, que segue ocupando a linha toda. */}
          <div className="lg:rounded-lg lg:border lg:border-border lg:bg-surface">
            <Link
              href={`/tournaments/${tournament.id}`}
              className="flex items-start justify-between gap-3 p-4 transition-all duration-200 hover:bg-surface-hover active:scale-[0.99] lg:rounded-lg"
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
              <Badge variant={TOURNAMENT_STATUS_VARIANT[tournament.status]}>
                {tournament.status}
              </Badge>
            </Link>

            {/* Atalho para o fechamento sem passar pelo detalhe (`RT-FE-05`):
                num torneio encerrado, é a única coisa que o admin ainda vai
                querer fazer com aquela linha. Cancelado também tem relatório
                (`RT-002`), mas ali o caminho continua sendo o detalhe — no
                lobby, "ver relatório" ao lado de um torneio que nem aconteceu
                convida ao clique errado. */}
            {isAdmin && tournament.status === TournamentStatus.FINISHED && (
              <p className="px-4 pb-3 text-sm">
                <TextLink href={`/tournaments/${tournament.id}/report`}>Ver relatório</TextLink>
              </p>
            )}
          </div>
        </RevealItem>
      ))}
    </Reveal>
  );
}
