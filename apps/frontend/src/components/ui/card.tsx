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
 * Container de conteúdo com borda/raio/padding padronizados, alinhado aos
 * tokens `--background`/`--foreground` definidos em `globals.css`.
 */
export function Card({ padding = 'md', title, footer, className, children, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-slate-200 bg-background text-foreground shadow-sm',
        'dark:border-slate-800',
        paddings[padding],
        className,
      )}
      {...rest}
    >
      {title && <h3 className="mb-2 text-base font-semibold">{title}</h3>}
      {children}
      {footer && (
        <div className="mt-4 border-t border-slate-200 pt-3 dark:border-slate-800">{footer}</div>
      )}
    </div>
  );
}
