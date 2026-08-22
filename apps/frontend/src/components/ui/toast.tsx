'use client';

import { motion } from 'framer-motion';
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
  success: 'border-success/40 bg-success/10 text-foreground',
  error: 'border-danger/40 bg-danger/10 text-foreground',
  warning: 'border-accent/40 bg-accent/10 text-foreground',
  info: 'border-border bg-surface text-foreground',
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
    <motion.div
      data-type={type}
      role={assertive ? 'alert' : 'status'}
      aria-live={assertive ? 'assertive' : 'polite'}
      initial={{ opacity: 0, y: -6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 400, damping: 28 }}
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
    </motion.div>
  );
}
