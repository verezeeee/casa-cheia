'use client';

import { UserRole } from '@poker-system/shared';
import { RequireAuth } from '@/components/auth/require-auth';
import { useSession } from '@/components/providers/session-provider';
import { CreateTableForm } from '@/components/table/create-table-form';
import { TableList } from '@/components/table/table-list';

function LobbyContent() {
  const { user } = useSession();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Lobby</h1>
        {user?.role === UserRole.ADMIN && <CreateTableForm />}
      </div>
      <TableList />
    </main>
  );
}

export default function LobbyPage() {
  return (
    <RequireAuth>
      <LobbyContent />
    </RequireAuth>
  );
}
