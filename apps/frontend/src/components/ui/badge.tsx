import type { ReactNode } from 'react';
import { cn } from './cn';

export type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
}

const variants: Record<BadgeVariant, string> = {
  success: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  warning: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  danger: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
  info: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
  neutral: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
};

/**
 * Rótulo compacto para status semânticos (ex.: "ATIVO", "PENDENTE").
 * A cor é apenas reforço visual - o texto sempre carrega o significado.
 */
export function Badge({ variant = 'neutral', children, className }: BadgeProps) {
  return (
    <span
      data-variant={variant}
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
        'uppercase tracking-wide',
        variants[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
