'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { blindStructureApi } from '@/lib/api/blind-structure';
import { tournamentApi } from '@/lib/api/tournament';
import { Button, Card, Toast } from '@/components/ui';
import { ApiError } from '@/lib/http-client';
import { TournamentFormFields, useTournamentFormState } from './tournament-form-fields';

/** Visível apenas para ADMIN — o botão que a renderiza já checa `session.clubeRole`. */
export function CreateTournamentForm() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useTournamentFormState();

  // `enabled: open`: o form fechado é só um botão — não vale buscar o catálogo
  // em toda visita de admin ao lobby de torneios.
  const { data: blindStructures } = useQuery({
    queryKey: ['blind-structures'],
    queryFn: () => blindStructureApi.listBlindStructures(),
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: () => tournamentApi.createTournament(form.toPayload()),
    onSuccess: () => {
      setError(null);
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['tournaments'] });
    },
    onError: (caught: unknown) => {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível criar o torneio.');
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate();
  }

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        + Criar torneio
      </Button>
    );
  }

  return (
    <Card title="Novo torneio">
      <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2">
        {error && (
          <div className="sm:col-span-2">
            <Toast type="error" message={error} />
          </div>
        )}

        <TournamentFormFields idPrefix="trn-new" state={form} blindStructures={blindStructures} />

        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" loading={mutation.isPending} loadingText="Criando...">
            Criar torneio
          </Button>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
        </div>
      </form>
    </Card>
  );
}
