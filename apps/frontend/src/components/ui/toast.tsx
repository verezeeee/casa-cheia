'use client';

import type { ReactNode } from 'react';
import { cn } from './cn';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastProps {
  type?: ToastType;
  message: ReactNode;
  /** Título opcional exibido em destaque acima da mensagem. */
  title?: string;
  /** Quando informado, renderiza o botão de fechar. */
  onClose?: () => void;
  /** Texto acessível do botão de fechar. */
  closeLabel?: string;
  className?: string;
}

const styles: Record<ToastType, string> = {
  success:
    'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100',
  error:
    'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100',
  warning:
    'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100',
  info: 'border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100',
};

/**
 * Notificação visual controlada por props (sem fila global - a orquestração
 * pode vir depois em um provider, reaproveitando este componente).
 *
 * Erros e avisos usam `role="alert"` (assertivo, interrompe o leitor de tela);
 * sucesso e informação usam `role="status"` (polido), evitando ruído.
 */
export function Toast({
  type = 'info',
  message,
  title,
  onClose,
  closeLabel = 'Fechar notificação',
  className,
}: ToastProps) {
  const assertive = type === 'error' || type === 'warning';

  return (
    <div
      data-type={type}
      role={assertive ? 'alert' : 'status'}
      aria-live={assertive ? 'assertive' : 'polite'}
      className={cn(
        'flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-sm',
        styles[type],
        className,
      )}
    >
      <div className="flex-1">
        {title && <p className="font-semibold">{title}</p>}
        <p>{message}</p>
      </div>

      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label={closeLabel}
          className="-mr-1 shrink-0 rounded p-1 text-lg leading-none opacity-70 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
        >
          <span aria-hidden="true">&times;</span>
        </button>
      )}
    </div>
  );
}
