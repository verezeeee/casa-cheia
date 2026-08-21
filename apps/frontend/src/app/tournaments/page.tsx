'use client';

import { UserRole } from '@poker-system/shared';
import { RequireAuth } from '@/components/auth/require-auth';
import { useSession } from '@/components/providers/session-provider';
import { CreateTournamentForm } from '@/components/tournament/create-tournament-form';
import { TournamentList } from '@/components/tournament/tournament-list';

function TournamentsContent() {
  const { user } = useSession();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Torneios</h1>
        {user?.role === UserRole.ADMIN && <CreateTournamentForm />}
      </div>
      <TournamentList />
    </main>
  );
}

export default function TournamentsPage() {
  return (
    <RequireAuth>
      <TournamentsContent />
    </RequireAuth>
  );
}
