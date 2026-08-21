import { RequireAuth } from '@/components/auth/require-auth';
import { SeatGrid } from '@/components/table/seat-grid';

export default async function TableDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <RequireAuth>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
        <h1 className="text-2xl font-semibold tracking-tight">Mesa</h1>
        <SeatGrid tableId={id} />
      </main>
    </RequireAuth>
  );
}
