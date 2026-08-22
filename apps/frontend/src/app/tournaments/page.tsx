'use client';

import { UserRole } from '@poker-system/shared';
import { RequireAuth } from '@/components/auth/require-auth';
import { useSession } from '@/components/providers/session-provider';
import { CreateTournamentForm } from '@/components/tournament/create-tournament-form';
import { TournamentList } from '@/components/tournament/tournament-list';

function TournamentsContent() {
  const { user } = useSession();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Torneios</h1>
      {/* Ver nota equivalente em app/lobby/page.tsx: o <div> evita que o
          botão "+ Criar torneio" (fechado) estique para a largura inteira
          por herdar `align-items: stretch` do <main>, e mantém o formulário
          fora da linha do <h1> quando aberto. */}
      {user?.role === UserRole.ADMIN && (
        <div>
          <CreateTournamentForm />
        </div>
      )}
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
