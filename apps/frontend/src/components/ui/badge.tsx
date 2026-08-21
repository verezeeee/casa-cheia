import type { ReactNode } from 'react';
import { cn } from './cn';

export type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
}

const dotColor: Record<BadgeVariant, string> = {
  success: 'bg-success',
  warning: 'bg-accent',
  danger: 'bg-danger',
  info: 'bg-foreground',
  neutral: 'bg-muted',
};

/**
 * Rótulo compacto para status semânticos (ex.: "ATIVO", "PENDENTE").
 * Um ponto de cor + borda fina — como a aba colorida de uma ficha de poker,
 * não um preenchimento sólido. O texto sempre carrega o significado.
 */
export function Badge({ variant = 'neutral', children, className }: BadgeProps) {
  return (
    <span
      data-variant={variant}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5',
        'text-xs font-semibold uppercase tracking-wide text-foreground',
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', dotColor[variant])} aria-hidden="true" />
      {children}
    </span>
  );
}
