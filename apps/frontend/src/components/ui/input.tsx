'use client';

import { forwardRef, useId, type InputHTMLAttributes } from 'react';
import { cn } from './cn';
import { useFormFieldContext } from './form-field';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Label próprio; omita quando o `Input` estiver dentro de um `FormField`. */
  label?: string;
  /** Mensagem de erro; ativa `aria-invalid` e é ligada via `aria-describedby`. */
  error?: string;
  /** Texto auxiliar exibido quando não há erro. */
  hint?: string;
}

/**
 * Campo de texto acessível.
 *
 * Pode ser usado isolado (com `label`/`error` próprios) ou dentro de um
 * `FormField`, de quem herda id, `aria-describedby` e estado de erro.
 * `forwardRef` mantém a compatibilidade com o `register()` do react-hook-form.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, hint, id, className, 'aria-describedby': ariaDescribedBy, ...rest },
  ref,
) {
  const generatedId = useId();
  const field = useFormFieldContext();
  const inputId = id ?? field?.id ?? generatedId;

  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;
  const invalid = Boolean(error) || Boolean(field?.invalid);

  const describedBy =
    cn(
      hint && !error ? hintId : undefined,
      error ? errorId : undefined,
      field?.describedBy,
      ariaDescribedBy,
    ) || undefined;

  return (
    <div className={cn('flex w-full flex-col gap-1.5')}>
      {label && (
        <label htmlFor={inputId} className="text-sm font-medium text-foreground">
          {label}
        </label>
      )}

      <input
        ref={ref}
        id={inputId}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={cn(
          'h-11 w-full rounded-lg border bg-background px-3 text-base text-foreground',
          'placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2',
          'focus-visible:ring-offset-1 focus-visible:ring-offset-background',
          'disabled:cursor-not-allowed disabled:opacity-60',
          invalid
            ? 'border-red-500 focus-visible:ring-red-500'
            : 'border-slate-300 focus-visible:ring-emerald-500 dark:border-slate-700',
          className,
        )}
        {...rest}
      />

      {hint && !error && (
        <p id={hintId} className="text-xs text-slate-500 dark:text-slate-400">
          {hint}
        </p>
      )}

      {error && (
        <p id={errorId} role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
});
