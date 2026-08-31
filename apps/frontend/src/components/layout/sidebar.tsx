'use client';

import { ClubeRole } from '@poker-system/shared';
import { SignOut, Timer, UsersThree } from '@phosphor-icons/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from '@/components/providers/session-provider';
import { cn } from '@/components/ui';
import { ClubSwitcher } from './club-switcher';
import { Logo } from './logo';
import { isNavTabActive, NAV_TABS } from './nav-tabs';

const ADMIN_LINKS = [
  { href: '/membros', label: 'Membros', Icon: UsersThree },
  { href: '/blind-structures', label: 'Blinds', Icon: Timer },
] as const;

const LINK_CLASS = (active: boolean) =>
  cn(
    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200',
    active ? 'bg-surface-hover text-accent' : 'text-muted hover:bg-surface-hover',
  );

/**
 * Navegação desktop (`lg:` pra cima): sidebar fixa à esquerda, substitui
 * `TopBar` + `BottomNav` (ambos ganham `lg:hidden`). Sempre montada — a
 * ocultação abaixo de `lg` é só CSS (`hidden lg:flex`), mesmo espírito do
 * `AuthLayout` público, não um componente condicional em JS.
 *
 * Os itens ADMIN (Membros/Blinds) só existem aqui como navegação de
 * verdade — no mobile continuam só como `TextLink` dentro do conteúdo da
 * página (`lobby`, formulário de criar torneio), porque a bottom nav não
 * tem espaço sobrando para eles.
 */
export function Sidebar() {
  const pathname = usePathname();
  const { user, clubeRole, logout } = useSession();
  const isAdmin = clubeRole === ClubeRole.ADMIN;

  return (
    <aside className="hidden shrink-0 lg:flex lg:w-64 lg:flex-col lg:border-r lg:border-border lg:p-4">
      <Link href="/lobby" className="px-3 transition-opacity duration-200 hover:opacity-80">
        <Logo className="text-lg" />
      </Link>

      <div className="mt-6">
        <ClubSwitcher />
      </div>

      <nav aria-label="Navegação principal" className="mt-6 flex flex-col gap-1">
        {NAV_TABS.map((tab) => {
          const active = isNavTabActive(pathname, tab.matches);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className={LINK_CLASS(active)}
            >
              <tab.Icon weight={active ? 'fill' : 'regular'} size={20} aria-hidden="true" />
              {tab.label}
            </Link>
          );
        })}
      </nav>

      {isAdmin && (
        <>
          <div className="my-4 border-t border-border" />
          <nav aria-label="Administração" className="flex flex-col gap-1">
            {ADMIN_LINKS.map((link) => {
              const active = isNavTabActive(pathname, [link.href]);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? 'page' : undefined}
                  className={LINK_CLASS(active)}
                >
                  <link.Icon weight={active ? 'fill' : 'regular'} size={20} aria-hidden="true" />
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </>
      )}

      <div className="mt-auto flex flex-col gap-2 border-t border-border pt-4">
        <span className="truncate px-3 text-sm text-muted">{user?.name}</span>
        <button type="button" onClick={() => void logout()} className={LINK_CLASS(false)}>
          <SignOut weight="regular" size={20} aria-hidden="true" />
          Sair
        </button>
      </div>
    </aside>
  );
}
