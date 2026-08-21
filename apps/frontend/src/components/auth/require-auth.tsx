'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useSession } from '@/components/providers/session-provider';
import { Spinner } from '@/components/ui';

/**
 * Wrapper de rota protegida. Enquanto a sessão hidrata (`status ===
 * 'loading'`), mostra um spinner em vez de piscar o conteúdo protegido ou
 * redirecionar cedo demais — a hidratação inicial sempre chama `me()` (ver
 * `SessionProvider`), então "loading" é sempre transitório, nunca final.
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

  return <>{children}</>;
}
