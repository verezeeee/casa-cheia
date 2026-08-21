import type { ReactNode } from 'react';
import { cn } from './cn';

export interface EmptyStateProps {
  title: string;
  description?: string;
  /** Slot de ação (ex.: um `Button` "Fazer depósito"). */
  action?: ReactNode;
  /** Ícone/ilustração opcional; renderizado como decorativo. */
  icon?: ReactNode;
  className?: string;
}

/**
 * Estado vazio de listas (ex.: "Nenhuma transação ainda").
 * O ícone é sempre decorativo - a informação vive no título/descrição.
 */
export function EmptyState({ title, description, action, icon, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-md border border-dashed',
        'border-border px-6 py-10 text-center',
        className,
      )}
    >
      {icon && (
        <span aria-hidden="true" className="text-3xl text-muted">
          {icon}
        </span>
      )}

      <p className="font-display text-lg font-semibold text-foreground">{title}</p>

      {description && <p className="max-w-xs text-sm text-muted">{description}</p>}

      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
