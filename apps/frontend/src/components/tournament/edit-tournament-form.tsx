'use client';

import type { TournamentDetailResponse } from '@poker-system/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FormEvent } from 'react';
import { useState } from 'react';
import { blindStructureApi } from '@/lib/api/blind-structure';
import { tournamentApi } from '@/lib/api/tournament';
import { Button, Card, Toast } from '@/components/ui';
import { ApiError } from '@/lib/http-client';
import { TournamentFormFields, useTournamentFormState } from './tournament-form-fields';

/**
 * Só é montado quando o backend já garantiria a edição (`REGISTERING` +
 * `registeredPlayers === 0`, ver `TournamentService.updateTournament`) — o
 * botão que abre este form em `tournament-detail.tsx` checa a mesma condição.
 */
export function EditTournamentForm({
  tournament,
  onClose,
}: {
  tournament: TournamentDetailResponse;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const form = useTournamentFormState({
    name: tournament.name,
    buyIn: tournament.buyIn,
    fee: tournament.fee,
    startingStack: tournament.startingStack,
    maxPlayers: tournament.maxPlayers,
    tableCapacity: tournament.tableCapacity,
    startsAt: tournament.startsAt,
    blindStructureId: tournament.blindStructureId,
    allowReentry: tournament.allowReentry,
    maxReentries: tournament.maxReentries,
    reentryUntilLevel: tournament.reentryUntilLevel,
    staffBonusCost: tournament.staffBonusCost,
    staffBonusChips: tournament.staffBonusChips,
    prizes: tournament.prizes,
  });

  const { data: blindStructures } = useQuery({
    queryKey: ['blind-structures'],
    queryFn: () => blindStructureApi.listBlindStructures(),
  });

  const mutation = useMutation({
    mutationFn: () => tournamentApi.updateTournament(tournament.id, form.toPayload()),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['tournaments', tournament.id] });
      void queryClient.invalidateQueries({ queryKey: ['tournaments'] });
      onClose();
    },
    onError: (caught: unknown) => {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível salvar o torneio.');
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate();
  }

  return (
    <Card title="Editar torneio">
      <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2">
        {error && (
          <div className="sm:col-span-2">
            <Toast type="error" message={error} />
          </div>
        )}

        <TournamentFormFields idPrefix="trn-edit" state={form} blindStructures={blindStructures} />

        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" loading={mutation.isPending} loadingText="Salvando...">
            Salvar
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
        </div>
      </form>
    </Card>
  );
}
