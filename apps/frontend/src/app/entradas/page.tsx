import { RequireAuth } from '@/components/auth/require-auth';
import { EntryHistoryList } from '@/components/entries/entry-history-list';

export default function EntradasPage() {
  return (
    <RequireAuth>
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 sm:p-6 lg:max-w-4xl lg:p-8">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Entradas</h1>
        <EntryHistoryList />
      </main>
    </RequireAuth>
  );
}
