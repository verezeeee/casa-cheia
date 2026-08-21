import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

export type CardPadding = 'none' | 'sm' | 'md' | 'lg';

// `title` nativo (tooltip, string) é omitido em favor de um cabeçalho rico.
export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  padding?: CardPadding;
  /** Título opcional renderizado como cabeçalho do card. */
  title?: ReactNode;
  /** Área opcional no rodapé (ex.: ações). */
  footer?: ReactNode;
  children?: ReactNode;
}

const paddings: Record<CardPadding, string> = {
  none: 'p-0',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
};

/**
 * Container de conteúdo, alinhado aos tokens `--surface`/`--border` definidos
 * em `globals.css`. O título, quando presente, leva a régua de ledger
 * (`.ledger-rule`) — o motivo estrutural recorrente desta identidade visual.
 */
export function Card({ padding = 'md', title, footer, className, children, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-md border border-border bg-surface text-foreground shadow-sm',
        paddings[padding],
        className,
      )}
      {...rest}
    >
      {title && (
        <h3 className="ledger-rule mb-3 text-base font-semibold tracking-tight">{title}</h3>
      )}
      {children}
      {footer && <div className="mt-4 border-t border-border pt-3">{footer}</div>}
    </div>
  );
}
