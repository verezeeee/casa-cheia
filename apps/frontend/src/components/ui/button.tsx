'use client';

import type { ButtonHTMLAttributes, MouseEvent } from 'react';
import { cn } from './cn';
import { Spinner } from './spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Desabilita o botão e exibe o spinner. */
  loading?: boolean;
  /** Texto opcional exibido no lugar do label enquanto `loading`. */
  loadingText?: string;
  fullWidth?: boolean;
  /** Explícito por padrão para nunca submeter um form sem querer. */
  type?: 'button' | 'submit' | 'reset';
}

const base =
  'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ' +
  'focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-emerald-600 text-white hover:bg-emerald-500 focus-visible:ring-emerald-500',
  secondary:
    'border border-slate-300 text-foreground hover:bg-slate-100 focus-visible:ring-slate-400 ' +
    'dark:border-slate-700 dark:hover:bg-slate-800',
  danger: 'bg-red-600 text-white hover:bg-red-500 focus-visible:ring-red-500',
  ghost: 'text-foreground hover:bg-slate-100 focus-visible:ring-slate-400 dark:hover:bg-slate-800',
};

// Alturas pensadas para toque (mobile-first): `md`/`lg` ficam acima dos 44px
// recomendados como alvo mínimo.
const sizes: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-sm',
  md: 'h-11 px-4 text-base',
  lg: 'h-14 px-6 text-lg',
};

const spinnerSize: Record<ButtonSize, 'sm' | 'md'> = {
  sm: 'sm',
  md: 'sm',
  lg: 'md',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  loadingText,
  fullWidth = false,
  type = 'button',
  disabled = false,
  className,
  children,
  onClick,
  ...rest
}: ButtonProps) {
  const isBlocked = loading || disabled;

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    // Guarda redundante ao atributo `disabled`: protege contra duplo-clique em
    // ações sensíveis (ex.: confirmar saque) caso o botão seja renderizado com
    // `aria-disabled` no futuro.
    if (isBlocked) {
      event.preventDefault();
      return;
    }

    onClick?.(event);
  }

  return (
    <button
      type={type}
      disabled={isBlocked}
      aria-busy={loading || undefined}
      onClick={handleClick}
      className={cn(base, variants[variant], sizes[size], fullWidth && 'w-full', className)}
      {...rest}
    >
      {loading && <Spinner size={spinnerSize[size]} decorative />}
      <span>{loading && loadingText ? loadingText : children}</span>
    </button>
  );
}
