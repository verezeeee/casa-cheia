import { RequireAuth } from '@/components/auth/require-auth';
import { PageHeader } from '@/components/layout/page-header';
import { BlindStructureManager } from '@/components/tournament/blind-structure-manager';

export default function BlindStructuresPage() {
  return (
    <RequireAuth>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 sm:p-6 lg:max-w-5xl lg:p-8">
        <PageHeader title="Estruturas de blinds" backHref="/tournaments" />
        <BlindStructureManager />
      </main>
    </RequireAuth>
  );
}
