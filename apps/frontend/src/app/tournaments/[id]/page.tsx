import { RequireAuth } from '@/components/auth/require-auth';
import { TournamentDetail } from '@/components/tournament/tournament-detail';

export default async function TournamentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <RequireAuth>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 sm:p-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Torneio</h1>
        <TournamentDetail tournamentId={id} />
      </main>
    </RequireAuth>
  );
}
