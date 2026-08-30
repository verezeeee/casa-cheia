import { PokerChip, Trophy, Wallet } from '@phosphor-icons/react';

/**
 * Abas de navegação primária — compartilhadas entre `BottomNav` (mobile,
 * sempre) e `Sidebar` (desktop, `lg:`), pra não duplicar a lista de rotas.
 */
export const NAV_TABS = [
  { href: '/lobby', matches: ['/lobby', '/tables'], label: 'Mesas', Icon: PokerChip },
  { href: '/tournaments', matches: ['/tournaments'], label: 'Torneios', Icon: Trophy },
  { href: '/wallet', matches: ['/wallet'], label: 'Carteira', Icon: Wallet },
] as const;

export function isNavTabActive(pathname: string, matches: readonly string[]): boolean {
  return matches.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
