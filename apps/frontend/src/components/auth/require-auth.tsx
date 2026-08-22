'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useSession } from '@/components/providers/session-provider';
import { BottomNav } from '@/components/layout/bottom-nav';
import { TopBar } from '@/components/layout/top-bar';
import { Spinner } from '@/components/ui';

/**
 * Wrapper de rota protegida. Enquanto a sessão hidrata (`status ===
 * 'loading'`), mostra um spinner em vez de piscar o conteúdo protegido ou
 * redirecionar cedo demais — a hidratação inicial sempre chama `me()` (ver
 * `SessionProvider`), então "loading" é sempre transitório, nunca final.
 *
 * Também é o único lugar (todas as páginas protegidas passam por aqui) que
 * monta o chrome de navegação (`TopBar`/`BottomNav`) — cada página só
 * precisa cuidar do próprio conteúdo, nunca da casca.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
    }
  }, [status, router]);

  if (status !== 'authenticated') {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <Spinner label="Carregando sessão" />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <TopBar />
      <div className="flex-1 pb-20">{children}</div>
      <BottomNav />
    </div>
  );
}
