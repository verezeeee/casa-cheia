'use client';

import { Button, type ButtonVariant } from './button';
import { Dialog } from './dialog';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Confirmar como ação destrutiva (botão vermelho) — fechar mesa, cancelar torneio etc. */
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmação de ação — substitui `window.confirm` (modal do navegador,
 * fora do idioma visual do produto). Composição fina sobre `Dialog`.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  danger = false,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmVariant: ButtonVariant = danger ? 'danger' : 'primary';

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={confirmVariant} size="sm" loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {description}
    </Dialog>
  );
}
