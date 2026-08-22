'use client';

import { TournamentEntryStatus, TournamentStatus, UserRole } from '@poker-system/shared';
import type { BadgeVariant } from '@/components/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useSession } from '@/components/providers/session-provider';
import { tournamentApi } from '@/lib/api/tournament';
import { Badge, Button, Card, Input, Spinner, Toast } from '@/components/ui';
import { ApiError } from '@/lib/http-client';
import { formatDateTimeSafe, formatMoneySafe } from '@/lib/format';

const STATUS_VARIANT: Record<TournamentStatus, BadgeVariant> = {
  [TournamentStatus.DRAFT]: 'warning',
  [TournamentStatus.REGISTERING]: 'success',
  [TournamentStatus.RUNNING]: 'info',
  [TournamentStatus.FINISHED]: 'neutral',
  [TournamentStatus.CANCELLED]: 'danger',
};

const ENTRY_STATUS_VARIANT: Record<TournamentEntryStatus, BadgeVariant> = {
  [TournamentEntryStatus.REGISTERED]: 'neutral',
  [TournamentEntryStatus.PLAYING]: 'info',
  [TournamentEntryStatus.ELIMINATED]: 'danger',
  [TournamentEntryStatus.PAID]: 'success',
  [TournamentEntryStatus.REFUNDED]: 'neutral',
};

export function TournamentDetail({ tournamentId }: { tournamentId: string }) {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [eliminating, setEliminating] = useState<string | null>(null);
  const [finalPosition, setFinalPosition] = useState('');

  const {
    data: tournament,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['tournaments', tournamentId],
    queryFn: () => tournamentApi.getTournament(tournamentId),
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['tournaments', tournamentId] });
    void queryClient.invalidateQueries({ queryKey: ['tournaments'] });
    void queryClient.invalidateQueries({ queryKey: ['wallet', 'balance'] });
  }

  const registerMutation = useMutation({
    mutationFn: () => tournamentApi.registerEntry(tournamentId, crypto.randomUUID()),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (caught: unknown) => {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível se inscrever.');
    },
  });

  const eliminateMutation = useMutation({
    mutationFn: (entryId: string) =>
      tournamentApi.eliminateEntry(tournamentId, entryId, {
        finalPosition: finalPosition ? Number(finalPosition) : undefined,
      }),
    onSuccess: () => {
      setError(null);
      setEliminating(null);
      setFinalPosition('');
      invalidate();
    },
    onError: (caught: unknown) => {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível eliminar.');
    },
  });

  const finishMutation = useMutation({
    mutationFn: () => tournamentApi.finishTournament(tournamentId),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (caught: unknown) => {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível encerrar.');
    },
  });

  function handleEliminate(event: FormEvent<HTMLFormElement>, entryId: string) {
    event.preventDefault();
    eliminateMutation.mutate(entryId);
  }

  if (isLoading) return <Spinner size="sm" label="Carregando torneio" />;
  if (isError || !tournament) {
    return <p className="text-danger">Não foi possível carregar o torneio.</p>;
  }

  const isAdmin = user?.role === UserRole.ADMIN;
  const myEntry = tournament.entries.find((e) => e.userId === user?.id);
  const canRegister =
    !myEntry &&
    tournament.status === TournamentStatus.REGISTERING &&
    tournament.registeredPlayers < tournament.maxPlayers;
  const canFinish =
    tournament.status === TournamentStatus.REGISTERING ||
    tournament.status === TournamentStatus.RUNNING;

  return (
    <div className="flex flex-col gap-4">
      {error && <Toast type="error" message={error} />}

      <Card>
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-display text-xl font-semibold">{tournament.name}</p>
            <p className="font-ledger text-sm text-muted">
              Buy-in {formatMoneySafe(tournament.buyIn)} + {formatMoneySafe(tournament.fee)} ·{' '}
              {formatDateTimeSafe(tournament.startsAt)}
            </p>
          </div>
          <Badge variant={STATUS_VARIANT[tournament.status]}>{tournament.status}</Badge>
        </div>
        <p className="mt-2 text-sm text-muted">
          {tournament.registeredPlayers}/{tournament.maxPlayers} inscritos
        </p>

        {canRegister && (
          <Button
            className="mt-3"
            fullWidth
            loading={registerMutation.isPending}
            onClick={() => registerMutation.mutate()}
          >
            Inscrever-se
          </Button>
        )}
        {myEntry && <p className="mt-3 text-sm text-success">Você está inscrito neste torneio.</p>}

        {isAdmin && canFinish && (
          <Button
            className="mt-3"
            variant="secondary"
            fullWidth
            loading={finishMutation.isPending}
            onClick={() => finishMutation.mutate()}
          >
            Encerrar torneio
          </Button>
        )}
      </Card>

      <Card title="Grade de premiação">
        <ul className="flex flex-col gap-1">
          {tournament.prizes.map((prize) => (
            <li key={prize.position} className="flex justify-between text-sm">
              <span className="text-muted">{prize.position}º lugar</span>
              <span className="font-ledger">{prize.percentage}%</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Inscritos">
        {tournament.entries.length === 0 ? (
          <p className="text-sm text-muted">Nenhuma inscrição ainda.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {tournament.entries.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-col gap-1 border-b border-border py-2 last:border-0"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-medium">{entry.userName}</span>
                  <Badge variant={ENTRY_STATUS_VARIANT[entry.status]}>{entry.status}</Badge>
                </div>
                <p className="font-ledger text-xs text-muted">
                  {entry.finalPosition ? `${entry.finalPosition}º lugar · ` : ''}
                  {entry.prizeAmount
                    ? `Prêmio ${formatMoneySafe(entry.prizeAmount)}`
                    : `${entry.chipStack} fichas`}
                </p>

                {isAdmin && entry.status === TournamentEntryStatus.REGISTERED && (
                  <>
                    {eliminating === entry.id ? (
                      <form
                        onSubmit={(e) => handleEliminate(e, entry.id)}
                        className="flex flex-col gap-2 sm:flex-row sm:items-center"
                      >
                        <div className="min-w-0 flex-1">
                          <Input
                            type="number"
                            min={1}
                            placeholder="Colocação final (opcional)"
                            value={finalPosition}
                            onChange={(e) => setFinalPosition(e.target.value)}
                          />
                        </div>
                        <div className="flex gap-2">
                          <Button
                            type="submit"
                            size="sm"
                            fullWidth
                            loading={eliminateMutation.isPending}
                          >
                            Confirmar
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            fullWidth
                            onClick={() => setEliminating(null)}
                          >
                            Cancelar
                          </Button>
                        </div>
                      </form>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => setEliminating(entry.id)}>
                        Eliminar
                      </Button>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
