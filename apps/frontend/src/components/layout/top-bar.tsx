'use client';

import Link from 'next/link';
import { useSession } from '@/components/providers/session-provider';
import { Button } from '@/components/ui';

/**
 * Cabeçalho mínimo das páginas autenticadas: identidade (wordmark + sessão)
 * e a única ação que não é "ir para uma seção" (sair). Navegação entre
 * seções vive no `BottomNav` — este cabeçalho não duplica esses links, só
 * teria que quebrar linha numa tela de 375px.
 */
export function TopBar() {
  const { user, logout } = useSession();

  return (
    <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
      <Link href="/lobby" className="font-display text-base font-semibold tracking-tight">
        <span className="text-accent">♠</span> Poker System
      </Link>
      <div className="flex min-w-0 items-center gap-2">
        <span className="hidden truncate text-sm text-muted sm:inline">{user?.name}</span>
        <Button variant="ghost" size="sm" onClick={() => void logout()}>
          Sair
        </Button>
      </div>
    </header>
  );
}
