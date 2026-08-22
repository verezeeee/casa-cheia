'use client';

import { Spade } from '@phosphor-icons/react';
import { cn } from '@/components/ui';

export interface LogoProps {
  className?: string;
  iconSize?: number;
}

/**
 * Marca da Casa Cheia: naipe vetorial (Phosphor `Spade`, peso preenchido) +
 * wordmark — substitui o caractere "♠" solto usado antes, que depende da
 * fonte de emoji do sistema em vez de um ícone com peso/cor controlados.
 * Único lugar que define a marca; `TopBar` e a landing pública reaproveitam.
 */
export function Logo({ className, iconSize = 18 }: LogoProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 font-display font-semibold tracking-tight',
        className,
      )}
    >
      <Spade weight="fill" size={iconSize} className="text-accent" aria-hidden="true" />
      Casa Cheia
    </span>
  );
}
