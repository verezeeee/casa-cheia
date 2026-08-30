import { ClockCounterClockwise, PokerChip, Trophy } from '@phosphor-icons/react';

/**
 * Abas de navegação primária — compartilhadas entre `BottomNav` (mobile,
 * sempre) e `Sidebar` (desktop, `lg:`), pra não duplicar a lista de rotas.
 */
export const NAV_TABS = [
  { href: '/lobby', matches: ['/lobby', '/tables'], label: 'Mesas', Icon: PokerChip },
  { href: '/tournaments', matches: ['/tournaments'], label: 'Torneios', Icon: Trophy },
  {
    href: '/entradas',
    matches: ['/entradas'],
    label: 'Entradas',
    Icon: ClockCounterClockwise,
  },
] as const;

export function isNavTabActive(pathname: string, matches: readonly string[]): boolean {
  return matches.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
