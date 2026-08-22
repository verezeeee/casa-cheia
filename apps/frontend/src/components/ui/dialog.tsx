'use client';

import { useEffect, useId, useRef, type MouseEvent, type ReactNode } from 'react';
import { cn } from './cn';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}

/**
 * Modal nativo (`<dialog>`): em navegadores com `showModal()`, foco preso e
 * Escape fecham de graça, sem reimplementar isso à mão. `hidden` é reforço
 * defensivo (cobre ambiente de teste/navegador sem suporte, onde o
 * `:not([open]) { display: none }` do UA stylesheet não é aplicado).
 * Clique fora do card fecha (checagem de bounding box — o clique no
 * `::backdrop` chega com `target` igual ao próprio `<dialog>`).
 *
 * `inset-0 m-auto` reafirma a centralização que o navegador dá de graça a
 * `dialog:modal` — o Preflight do Tailwind zera `margin` em `*`, o que
 * quebra o truque de `margin: auto` do UA stylesheet e prende a caixa no
 * canto superior esquerdo. `m-auto` é utilitário (camada `utilities`, depois
 * da `base` do Preflight na cascata), então volta a vencer. O fundo
 * escurecido (`::backdrop`) é regra própria em globals.css pelo mesmo
 * motivo: a variante `backdrop:` do Tailwind não é confiável o bastante
 * aqui para algo tão visível quanto isso.
 *
 * Base de qualquer notificação que precise interromper o fluxo do usuário —
 * nunca `window.confirm`/`alert`, que é modal do navegador, fora do controle
 * visual do produto (ver `ConfirmDialog`, que usa este componente).
 */
export function Dialog({ open, onClose, title, children, footer, className }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    if (open) {
      if (typeof node.showModal === 'function') {
        if (!node.open) node.showModal();
      } else {
        node.open = true;
      }
    } else if (typeof node.close === 'function') {
      if (node.open) node.close();
    } else {
      node.open = false;
    }
  }, [open]);

  function handleBackdropClick(event: MouseEvent<HTMLDialogElement>) {
    const node = event.currentTarget;
    if (event.target !== node) return; // clique dentro do conteúdo (filho), não no backdrop

    const rect = node.getBoundingClientRect();
    const insideContent =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;
    if (!insideContent) onClose();
  }

  return (
    <dialog
      ref={ref}
      hidden={!open}
      onClose={onClose}
      onCancel={onClose}
      onClick={handleBackdropClick}
      aria-labelledby={titleId}
      className={cn(
        'fixed inset-0 m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-sm overflow-y-auto',
        'rounded-lg border border-border bg-surface p-0 text-foreground shadow-lg',
        className,
      )}
    >
      <div className="p-4">
        <h2 id={titleId} className="font-display text-lg font-semibold tracking-tight">
          {title}
        </h2>
        {children && <div className="mt-2 text-sm text-muted">{children}</div>}
      </div>
      {footer && <div className="flex justify-end gap-2 border-t border-border p-3">{footer}</div>}
    </dialog>
  );
}
