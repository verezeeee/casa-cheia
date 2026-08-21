'use client';

import { createContext, useContext, useId, type ReactNode } from 'react';
import { cn } from './cn';

export interface FormFieldDescriptor {
  /** id que o controle deve usar (casa com o `htmlFor` do label). */
  id: string;
  /** Valor pronto para `aria-describedby` (dica e/ou erro), se houver. */
  describedBy?: string;
  /** `true` quando o campo está em erro (vira `aria-invalid` no controle). */
  invalid: boolean;
}

const FormFieldContext = createContext<FormFieldDescriptor | null>(null);

/**
 * Consumido pelos controles do design system (ex.: `Input`) para herdar id,
 * `aria-describedby` e estado de erro do `FormField` que os envolve, sem
 * precisar de `cloneElement`.
 */
export function useFormFieldContext(): FormFieldDescriptor | null {
  return useContext(FormFieldContext);
}

export interface FormFieldProps {
  label: string;
  /** Mensagem de erro; quando presente, marca o campo como inválido. */
  error?: string;
  /** Texto auxiliar exibido abaixo do controle quando não há erro. */
  hint?: string;
  /** Marca visualmente o campo como obrigatório. */
  required?: boolean;
  /** id do controle; por padrão é gerado e propagado via contexto. */
  htmlFor?: string;
  children: ReactNode | ((field: FormFieldDescriptor) => ReactNode);
  className?: string;
}

/**
 * Wrapper genérico de campo de formulário (label + controle + erro).
 *
 * A API (`label`, `error`, `children`) é compatível com o uso futuro junto a
 * `react-hook-form` (`errors.campo?.message` cai direto em `error`). Para
 * controles de terceiros, `children` também aceita render-prop e recebe os
 * ids/estado de acessibilidade já calculados.
 */
export function FormField({
  label,
  error,
  hint,
  required = false,
  htmlFor,
  children,
  className,
}: FormFieldProps) {
  const generatedId = useId();
  const id = htmlFor ?? generatedId;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const invalid = Boolean(error);

  const describedBy = cn(hint && !error ? hintId : undefined, error ? errorId : undefined);

  const descriptor: FormFieldDescriptor = {
    id,
    describedBy: describedBy || undefined,
    invalid,
  };

  return (
    <FormFieldContext.Provider value={descriptor}>
      <div className={cn('flex flex-col gap-1.5', className)}>
        <label htmlFor={id} className="text-sm font-medium text-foreground">
          {label}
          {required && (
            <span className="ml-0.5 text-danger" aria-hidden="true">
              *
            </span>
          )}
        </label>

        {typeof children === 'function' ? children(descriptor) : children}

        {hint && !error && (
          <p id={hintId} className="text-xs text-muted">
            {hint}
          </p>
        )}

        {error && (
          <p id={errorId} role="alert" className="text-xs font-medium text-danger">
            {error}
          </p>
        )}
      </div>
    </FormFieldContext.Provider>
  );
}
