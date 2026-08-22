'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/components/ui';

/**
 * Navegação primária do app autenticado. Barra fixa no rodapé (não um menu
 * de topo) porque é o padrão mobile-first: alcance de polegar, sempre
 * visível, sem gesto extra pra abrir. Continua funcional em telas largas —
 * não há necessidade de uma segunda variante "desktop".
 *
 * Cada aba usa um naipe de baralho como ícone em vez de um SVG genérico —
 * mesma linguagem visual do `suit-pip` do saldo (♠) e do wordmark do
 * cabeçalho: zero dependência de ícones, e a metáfora ("mesa", "torneio",
 * "dinheiro") já é a do próprio produto.
 */
const TABS = [
  { href: '/lobby', matches: ['/lobby', '/tables'], label: 'Mesas', glyph: '♠' },
  { href: '/tournaments', matches: ['/tournaments'], label: 'Torneios', glyph: '♣' },
  { href: '/wallet', matches: ['/wallet'], label: 'Carteira', glyph: '♦' },
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
      <ul className="mx-auto flex w-full max-w-3xl">
        {TABS.map((tab) => {
          const active = isActive(pathname, tab.matches);
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium',
                  active ? 'text-accent' : 'text-muted',
                )}
              >
                <span className="text-lg leading-none" aria-hidden="true">
                  {tab.glyph}
                </span>
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
