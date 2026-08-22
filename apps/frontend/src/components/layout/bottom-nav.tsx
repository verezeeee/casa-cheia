'use client';

import { PokerChip, Trophy, Wallet } from '@phosphor-icons/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/components/ui';

/**
 * Navegação primária do app autenticado. Barra fixa no rodapé (não um menu
 * de topo) porque é o padrão mobile-first: alcance de polegar, sempre
 * visível, sem gesto extra pra abrir. Continua funcional em telas largas —
 * não há necessidade de uma segunda variante "desktop".
 *
 * Ícones Phosphor (não os naipes de texto de antes, que dependiam da fonte
 * de emoji do sistema): contorno quando inativo, preenchido + cor de
 * destaque quando ativo — o mesmo padrão de tab bar do iOS/Material.
 */
const TABS = [
  { href: '/lobby', matches: ['/lobby', '/tables'], label: 'Mesas', Icon: PokerChip },
  { href: '/tournaments', matches: ['/tournaments'], label: 'Torneios', Icon: Trophy },
  { href: '/wallet', matches: ['/wallet'], label: 'Carteira', Icon: Wallet },
] as const;

function isActive(pathname: string, matches: readonly string[]): boolean {
  return matches.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navegação principal"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto flex w-full max-w-3xl gap-1 p-1.5">
        {TABS.map((tab) => {
          const active = isActive(pathname, tab.matches);
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-full text-xs',
                  'font-medium transition-all duration-300 hover:bg-surface-hover',
                  active ? 'text-accent' : 'text-muted',
                )}
              >
                <tab.Icon weight={active ? 'fill' : 'regular'} size={22} aria-hidden="true" />
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
