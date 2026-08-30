import { RequireAuth } from '@/components/auth/require-auth';
import { PageHeader } from '@/components/layout/page-header';
import { ClockControl } from '@/components/tournament/clock-control';

export default async function TournamentClockPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <RequireAuth>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 sm:p-6 lg:max-w-5xl lg:p-8">
        <PageHeader title="Relógio do torneio" backHref={`/tournaments/${id}`} />
        <ClockControl tournamentId={id} />
      </main>
    </RequireAuth>
  );
}
