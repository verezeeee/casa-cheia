import { ArrowLeft } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { cn } from './cn';

export interface BackLinkProps {
  href: string;
  label?: string;
  className?: string;
}

/**
 * Botão de voltar contextual para páginas de detalhe/sub-rota — as 3 abas
 * primárias (`BottomNav`) não precisam disso, só as páginas que pendem de
 * uma delas (detalhe de torneio, mesas, relógio, mesa de cash game, presets
 * de blind). Vale especialmente num PWA instalado, sem chrome de navegador
 * visível para o back nativo.
 *
 * Link real (`next/link`), não `onClick` + `router.back()`: preserva
 * abrir-em-nova-aba/cmd-click, e o destino é fixo porque a página pode ter
 * sido aberta direto por URL (deep link/refresh), sem histórico de
 * navegação dentro do app para voltar.
 */
export function BackLink({ href, label = 'Voltar', className }: BackLinkProps) {
  return (
    <Link
      href={href}
      aria-label={label}
      className={cn(
        'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-foreground',
        'transition-colors duration-200 hover:bg-surface-hover',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
        'focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-background',
        className,
      )}
    >
      <ArrowLeft weight="bold" size={18} aria-hidden="true" />
    </Link>
  );
}
