import { RequireAuth } from '@/components/auth/require-auth';
import { PageHeader } from '@/components/layout/page-header';
import { TableMap } from '@/components/tournament/table-map';

export default async function TournamentTablesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <RequireAuth>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 sm:p-6">
        <PageHeader title="Mesas do torneio" backHref={`/tournaments/${id}`} />
        <TableMap tournamentId={id} />
      </main>
    </RequireAuth>
  );
}
