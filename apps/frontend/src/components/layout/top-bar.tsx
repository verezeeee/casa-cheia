'use client';

import { SignOut } from '@phosphor-icons/react';
import Link from 'next/link';
import { useSession } from '@/components/providers/session-provider';
import { Button } from '@/components/ui';
import { ClubSwitcher } from './club-switcher';
import { Logo } from './logo';

/**
 * Cabeçalho mínimo das páginas autenticadas: identidade (wordmark + sessão),
 * a única ação que não é "ir para uma seção" (sair), e o `ClubSwitcher`
 * (trocar/criar/entrar em clube por código) — sem ele essas ações só
 * existiam na `Sidebar` e sumiam no mobile. Navegação entre seções vive no
 * `BottomNav` — este cabeçalho não duplica esses links. Some em `lg:` — a
 * `Sidebar` assume identidade/sessão/sair/clube a partir daí, senão
 * apareceriam duplicados.
 */
export function TopBar() {
  const { user, logout } = useSession();

  return (
    <header className="border-b border-border px-4 py-3 lg:hidden">
      <div className="flex items-center justify-between gap-3">
        <Link href="/lobby" className="transition-opacity duration-200 hover:opacity-80">
          <Logo className="text-base" />
        </Link>
        <div className="flex min-w-0 items-center gap-2">
          <span className="hidden truncate text-sm text-muted sm:inline">{user?.name}</span>
          <Button variant="ghost" size="sm" onClick={() => void logout()}>
            <SignOut weight="regular" size={16} aria-hidden="true" />
            Sair
          </Button>
        </div>
      </div>
      <ClubSwitcher className="mt-3 border-b-0 pb-0" />
    </header>
  );
}
