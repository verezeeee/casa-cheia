import { RequireAuth } from '@/components/auth/require-auth';
import { PageHeader } from '@/components/layout/page-header';
import { ClubMembersManager } from '@/components/club/club-members-manager';

/** ADMIN — o backend responde 403/404 pra quem não é; a tela não checa de novo. */
export default function MembrosPage() {
  return (
    <RequireAuth>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 sm:p-6">
        <PageHeader title="Membros do clube" backHref="/lobby" />
        <ClubMembersManager />
      </main>
    </RequireAuth>
  );
}
