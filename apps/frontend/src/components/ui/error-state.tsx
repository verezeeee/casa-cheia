import type { ReactNode } from 'react';
import { cn } from './cn';

export interface ErrorStateProps {
  title?: string;
  description?: string;
  /** Slot de ação (ex.: um `Button` "Tentar novamente"). */
  action?: ReactNode;
  className?: string;
}

/**
 * Par do `EmptyState` para falhas de carregamento — mesmo esqueleto visual,
 * papel semântico diferente (`role="alert"`). Substitui os vários
 * `<p className="text-danger">Não foi possível...</p>` inline repetidos em
 * cada lista.
 */
export function ErrorState({
  title = 'Não foi possível carregar',
  description,
  action,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-md border border-dashed',
        'border-danger/40 bg-danger/5 px-6 py-10 text-center',
        className,
      )}
    >
      <p className="font-display text-lg font-semibold text-danger">{title}</p>
      {description && <p className="max-w-xs text-sm text-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
