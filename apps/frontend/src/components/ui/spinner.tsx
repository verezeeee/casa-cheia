import { cn } from './cn';

export type SpinnerSize = 'sm' | 'md' | 'lg';

export interface SpinnerProps {
  size?: SpinnerSize;
  /** Texto lido por leitores de tela (visualmente oculto). */
  label?: string;
  /**
   * Quando o spinner é apenas decorativo (ex.: dentro de um `Button` que já
   * expõe `aria-busy`), evita anunciar um segundo status redundante.
   */
  decorative?: boolean;
  className?: string;
}

const sizes: Record<SpinnerSize, string> = {
  sm: 'h-4 w-4 border-2',
  md: 'h-6 w-6 border-2',
  lg: 'h-10 w-10 border-4',
};

/**
 * Indicador de carregamento acessível.
 *
 * Por padrão anuncia-se como `role="status"` com um texto oculto; use
 * `decorative` para suprimir o anúncio quando o contexto já informa o estado.
 */
export function Spinner({
  size = 'md',
  label = 'Carregando...',
  decorative = false,
  className,
}: SpinnerProps) {
  const circle = (
    <span
      data-testid="spinner-circle"
      className={cn(
        'inline-block animate-spin rounded-full border-current border-t-transparent',
        sizes[size],
        decorative ? className : undefined,
      )}
    />
  );

  if (decorative) {
    return (
      <span aria-hidden="true" className="contents">
        {circle}
      </span>
    );
  }

  return (
    <span role="status" aria-live="polite" className={cn('inline-flex items-center', className)}>
      {circle}
      <span className="sr-only">{label}</span>
    </span>
  );
}
