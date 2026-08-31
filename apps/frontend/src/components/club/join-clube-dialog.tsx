'use client';

import type { ClubeSummaryDto } from '@poker-system/shared';
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Button, Dialog, FormField, Input, Toast } from '@/components/ui';
import { clubApi } from '@/lib/api/club-context';
import { ApiError } from '@/lib/http-client';

export interface JoinClubeDialogProps {
  open: boolean;
  onClose: () => void;
  /** Chamado com o clube recém-ingressado (o usuário entra como PLAYER). */
  onSuccess: (clube: ClubeSummaryDto) => void;
}

/**
 * Entrar num clube existente pelo código de 6 dígitos — ingresso imediato
 * como PLAYER, sem aprovação por enquanto (`POST /clubes/entrar`, ver
 * docblock de `ClubService.joinByCode`). Mesmo motivo de ser controlado que
 * `CreateClubeDialog`: reusado pelo `ClubSwitcher` e pela tela de "sem clube".
 */
export function JoinClubeDialog({ open, onClose, onSuccess }: JoinClubeDialogProps) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => clubApi.joinClube({ code }),
    onSuccess: (clube) => {
      setError(null);
      setCode('');
      onSuccess(clube);
      onClose();
    },
    onError: (caught: unknown) => {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível entrar no clube.');
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate();
  }

  return (
    <Dialog open={open} onClose={onClose} title="Entrar com código">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 text-left">
        {error && <Toast type="error" message={error} />}

        <FormField
          label="Código do clube"
          htmlFor="join-clube-code"
          hint="6 dígitos, fornecido pelo administrador do clube."
        >
          <Input
            id="join-clube-code"
            inputMode="numeric"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          />
        </FormField>

        <div className="flex gap-2">
          <Button type="submit" loading={mutation.isPending} loadingText="Entrando...">
            Entrar
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
