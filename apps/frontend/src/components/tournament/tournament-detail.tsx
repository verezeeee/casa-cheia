'use client';

import { TournamentEntryStatus, TournamentStatus, ClubeRole } from '@poker-system/shared';
import type { TournamentEntryDto } from '@poker-system/shared';
import type { BadgeVariant } from '@/components/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useSession } from '@/components/providers/session-provider';
import { tournamentApi } from '@/lib/api/tournament';
import { Badge, Button, Card, ErrorState, Input, Skeleton, TextLink, Toast } from '@/components/ui';
import { ApiError } from '@/lib/http-client';
import { formatDateTimeSafe, formatMoneySafe } from '@/lib/format';
import { EditTournamentForm } from './edit-tournament-form';

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

// Ordem de leitura: quem ainda tá na mesa primeiro, depois quem falta
// entrar, depois quem já saiu — não a ordem alfabética do enum.
const STATUS_ORDER: TournamentEntryStatus[] = [
  TournamentEntryStatus.PLAYING,
  TournamentEntryStatus.REGISTERED,
  TournamentEntryStatus.PAID,
  TournamentEntryStatus.ELIMINATED,
  TournamentEntryStatus.REFUNDED,
];

const STATUS_GROUP_LABEL: Record<TournamentEntryStatus, string> = {
  [TournamentEntryStatus.PLAYING]: 'Jogando',
  [TournamentEntryStatus.REGISTERED]: 'Inscritos',
  [TournamentEntryStatus.PAID]: 'Premiados',
  [TournamentEntryStatus.ELIMINATED]: 'Eliminados',
  [TournamentEntryStatus.REFUNDED]: 'Reembolsados',
};

/**
 * "Ticket" do jogador. `null` enquanto o torneio não atribuiu assento (ou em
 * entries anteriores ao MVP de mesas, onde os campos nem existem no payload).
 */
function seatLabel(entry: TournamentEntryDto): string | null {
  return entry.tableNumber != null && entry.seatNumber != null
    ? `Mesa ${entry.tableNumber} · Assento ${entry.seatNumber}`
    : null;
}

export function TournamentDetail({ tournamentId }: { tournamentId: string }) {
  const { user, clubeRole } = useSession();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [wantsStaffBonus, setWantsStaffBonus] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
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
    mutationFn: () =>
      tournamentApi.registerEntry(tournamentId, crypto.randomUUID(), {
        staffBonus: wantsStaffBonus,
      }),
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

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-28 w-full rounded-lg" />
        <Skeleton className="h-32 w-full rounded-lg" />
      </div>
    );
  }
  if (isError || !tournament) {
    return <ErrorState description="Não foi possível carregar o torneio." />;
  }

  const isAdmin = clubeRole === ClubeRole.ADMIN;
  const myEntry = tournament.entries.find((e) => e.userId === user?.id);
  const myTicket = myEntry ? seatLabel(myEntry) : null;
  const canRegister =
    !myEntry &&
    tournament.status === TournamentStatus.REGISTERING &&
    tournament.registeredPlayers < tournament.maxPlayers;
  const canFinish =
    tournament.status === TournamentStatus.REGISTERING ||
    tournament.status === TournamentStatus.RUNNING;
  // Mesma condição do backend (`TournamentService.updateTournament`): só dá
  // para editar antes da 1ª inscrição — depois disso a config trava.
  const canEdit =
    isAdmin &&
    tournament.status === TournamentStatus.REGISTERING &&
    tournament.registeredPlayers === 0;

  const entryGroups = STATUS_ORDER.map((status) => ({
    status,
    entries: tournament.entries.filter((entry) => entry.status === status),
  })).filter((group) => group.entries.length > 0);

  if (isEditing) {
    return <EditTournamentForm tournament={tournament} onClose={() => setIsEditing(false)} />;
  }

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
          <div className="flex items-center gap-2">
            {canEdit && (
              <Button variant="ghost" size="sm" onClick={() => setIsEditing(true)}>
                Editar
              </Button>
            )}
            <Badge variant={STATUS_VARIANT[tournament.status]}>{tournament.status}</Badge>
          </div>
        </div>
        <p className="mt-2 text-sm text-muted">
          {tournament.registeredPlayers}/{tournament.maxPlayers} inscritos
        </p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <TextLink href={`/tournaments/${tournamentId}/tables`}>Ver mesas</TextLink>
          <TextLink href={`/tournaments/${tournamentId}/clock`}>Controlar relógio</TextLink>
          {/* Nova aba: a TV roda num segundo monitor enquanto o staff
              continua operando nesta tela. */}
          <TextLink
            href={`/display/tournaments/${tournamentId}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Tela de TV
          </TextLink>
        </div>

        {canRegister && (
          <>
            {/* Bônus de staff (staff add-on): OPCIONAL, só aparece quando o
                torneio oferece (`staffBonusCost` não nulo). Vai para a
                equipe, não para o prize pool — mesma ideia da fee, mas
                ninguém é obrigado. */}
            {tournament.staffBonusCost && (
              <label className="mt-3 flex items-center gap-2 text-sm font-medium text-foreground">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--accent)]"
                  checked={wantsStaffBonus}
                  onChange={(e) => setWantsStaffBonus(e.target.checked)}
                />
                Pagar bônus de staff ({formatMoneySafe(tournament.staffBonusCost)} → +
                {tournament.staffBonusChips} fichas)
              </label>
            )}
            <Button
              className="mt-3"
              fullWidth
              loading={registerMutation.isPending}
              onClick={() => registerMutation.mutate()}
            >
              Inscrever-se
            </Button>
          </>
        )}
        {myEntry &&
          (myTicket ? (
            <p className="font-display mt-3 text-lg font-semibold text-success">{myTicket}</p>
          ) : (
            <p className="mt-3 text-sm text-success">Você está inscrito neste torneio.</p>
          ))}

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
        <ul className="flex flex-col gap-3">
          {tournament.prizes.map((prize) => (
            <li key={prize.position} className="flex items-center gap-3 text-sm">
              <span className="w-16 shrink-0 text-muted">{prize.position}º lugar</span>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-hover">
                <span
                  className="block h-full rounded-full bg-accent"
                  style={{ width: `${prize.percentage}%` }}
                />
              </span>
              <span className="font-ledger w-14 shrink-0 text-right">{prize.percentage}%</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Inscritos">
        {tournament.entries.length === 0 ? (
          <p className="text-sm text-muted">Nenhuma inscrição ainda.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {entryGroups.map((group) => (
              <div key={group.status}>
                <p className="text-xs font-medium tracking-wide text-muted uppercase">
                  {STATUS_GROUP_LABEL[group.status]} · {group.entries.length}
                </p>
                <ul className="mt-2 flex flex-col gap-2 divide-y divide-border">
                  {group.entries.map((entry) => (
                    <EntryRow
                      key={entry.id}
                      entry={entry}
                      isAdmin={isAdmin}
                      isEliminating={eliminating === entry.id}
                      finalPosition={finalPosition}
                      onFinalPositionChange={setFinalPosition}
                      onStartEliminate={() => setEliminating(entry.id)}
                      onCancelEliminate={() => setEliminating(null)}
                      onSubmitEliminate={(e) => handleEliminate(e, entry.id)}
                      eliminating={eliminateMutation.isPending}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

interface EntryRowProps {
  entry: TournamentEntryDto;
  isAdmin: boolean;
  isEliminating: boolean;
  finalPosition: string;
  onFinalPositionChange: (value: string) => void;
  onStartEliminate: () => void;
  onCancelEliminate: () => void;
  onSubmitEliminate: (event: FormEvent<HTMLFormElement>) => void;
  eliminating: boolean;
}

function EntryRow({
  entry,
  isAdmin,
  isEliminating,
  finalPosition,
  onFinalPositionChange,
  onStartEliminate,
  onCancelEliminate,
  onSubmitEliminate,
  eliminating,
}: EntryRowProps) {
  const ticket = seatLabel(entry);

  return (
    <li className="flex flex-col gap-1 pt-2 first:pt-0">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-medium">{entry.userName}</span>
        <Badge variant={ENTRY_STATUS_VARIANT[entry.status]}>{entry.status}</Badge>
      </div>
      <p className="font-ledger text-xs text-muted">
        {entry.finalPosition ? `${entry.finalPosition}º lugar · ` : ''}
        {entry.prizeAmount
          ? `Prêmio ${formatMoneySafe(entry.prizeAmount)}`
          : `${entry.chipStack} fichas`}
        {ticket ? ` · ${ticket}` : ''}
      </p>

      {isAdmin && entry.status === TournamentEntryStatus.REGISTERED && (
        <>
          {isEliminating ? (
            <form
              onSubmit={onSubmitEliminate}
              className="flex flex-col gap-2 sm:flex-row sm:items-center"
            >
              <div className="min-w-0 flex-1">
                <Input
                  type="number"
                  min={1}
                  placeholder="Colocação final (opcional)"
                  value={finalPosition}
                  onChange={(e) => onFinalPositionChange(e.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" size="sm" fullWidth loading={eliminating}>
                  Confirmar
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  fullWidth
                  onClick={onCancelEliminate}
                >
                  Cancelar
                </Button>
              </div>
            </form>
          ) : (
            <Button size="sm" variant="ghost" onClick={onStartEliminate}>
              Eliminar
            </Button>
          )}
        </>
      )}
    </li>
  );
}
