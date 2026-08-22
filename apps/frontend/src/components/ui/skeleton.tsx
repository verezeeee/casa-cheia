import { cn } from './cn';

export interface SkeletonProps {
  className?: string;
}

/**
 * Bloco de carregamento no formato do conteúdo real (o chamador define
 * altura/largura via `className`) — para listas onde o `Spinner` genérico
 * não comunica o que está vindo. `Spinner` continua sendo o certo para
 * ações inline (botões `loading`).
 */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-surface-hover', className)}
    />
  );
}
