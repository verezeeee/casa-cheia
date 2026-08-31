'use client';

import type { ClubeSummaryDto } from '@poker-system/shared';
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Button, Dialog, FormField, Input, Toast } from '@/components/ui';
import { clubApi } from '@/lib/api/club-context';
import { ApiError } from '@/lib/http-client';

export interface CreateClubeDialogProps {
  open: boolean;
  onClose: () => void;
  /** Chamado com o clube recém-criado (o usuário já é ADMIN dele). */
  onSuccess: (clube: ClubeSummaryDto) => void;
}

/**
 * Criar um clube — qualquer usuário autenticado pode, e vira `ADMIN` na hora
 * (`POST /clubes`, ver docblock de `ClubService.createClube`). Reusado tanto
 * pelo `ClubSwitcher` (sidebar) quanto pela tela de "sem clube" do
 * `RequireAuth` — por isso é controlado (`open`/`onClose`), não dono do
 * próprio gatilho.
 */
export function CreateClubeDialog({ open, onClose, onSuccess }: CreateClubeDialogProps) {
  const [name, setName] = useState('');
  const [document, setDocument] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => clubApi.createClube({ name, document }),
    onSuccess: (clube) => {
      setError(null);
      setName('');
      setDocument('');
      onSuccess(clube);
      onClose();
    },
    onError: (caught: unknown) => {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível criar o clube.');
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate();
  }

  return (
    <Dialog open={open} onClose={onClose} title="Criar clube">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 text-left">
        {error && <Toast type="error" message={error} />}

        <FormField label="Nome do clube" htmlFor="create-clube-name">
          <Input
            id="create-clube-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </FormField>

        <FormField
          label="CNPJ ou CPF"
          htmlFor="create-clube-document"
          hint="Somente números, 11 (CPF) ou 14 (CNPJ) dígitos."
        >
          <Input
            id="create-clube-document"
            inputMode="numeric"
            required
            value={document}
            onChange={(e) => setDocument(e.target.value.replace(/\D/g, ''))}
          />
        </FormField>

        <div className="flex gap-2">
          <Button type="submit" loading={mutation.isPending} loadingText="Criando...">
            Criar clube
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
