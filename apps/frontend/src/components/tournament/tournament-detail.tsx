'use client';

import {
  TournamentEntryStatus,
  TournamentStatus,
  ClubeRole,
  ClubeMembershipStatus,
} from '@poker-system/shared';
import type { ClubeMembershipDto, TournamentEntryDto } from '@poker-system/shared';
import type { BadgeVariant } from '@/components/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useSession } from '@/components/providers/session-provider';
import { clubMembersApi } from '@/lib/api/club';
import { tournamentApi } from '@/lib/api/tournament';
import {
  Badge,
  Button,
  Card,
  Dialog,
  ErrorState,
  Input,
  Skeleton,
  TextLink,
  Toast,
} from '@/components/ui';
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
 * `Date.now()` FORA do componente de propósito: o lint de pureza do React
 * Compiler recusa chamada direta a função impura no corpo de render — só
 * dentro de uma função comum, textualmente fora do component/hook, escapa
 * da análise (é exatamente o "não depende de estado reativo" que o lint
 * checa; aqui é uma janela de tempo real, recalculada a cada render mesmo).
 */
function lateRegistrationOpen(lateRegUntil: string | null): boolean {
  return lateRegUntil !== null && Date.now() <= new Date(lateRegUntil).getTime();
}

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
  const [memberSearch, setMemberSearch] = useState('');
  const [confirmingMember, setConfirmingMember] = useState<ClubeMembershipDto | null>(null);
  const [confirmStaffBonus, setConfirmStaffBonus] = useState(false);

  const {
    data: tournament,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['tournaments', tournamentId],
    queryFn: () => tournamentApi.getTournament(tournamentId),
  });

  // Só ADMIN chama `GET .../membros` (o backend responde 403 pra quem não é)
  // — a query nem dispara pros outros papéis. Hook de query não pode vir
  // depois do `return` antecipado de loading/erro, então recalcula `isAdmin`
  // aqui (o `clubeRole` já está disponível desde o topo do componente).
  const isAdmin = clubeRole === ClubeRole.ADMIN;
  const { data: members } = useQuery({
    queryKey: ['clube', 'members'],
    queryFn: () => clubMembersApi.listMembers(),
    enabled: isAdmin,
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

  const registerForUserMutation = useMutation({
    mutationFn: (userId: string) =>
      tournamentApi.registerEntryForUser(tournamentId, userId, crypto.randomUUID(), {
        staffBonus: confirmStaffBonus,
      }),
    onSuccess: () => {
      setError(null);
      setMemberSearch('');
      setConfirmingMember(null);
      invalidate();
    },
    onError: (caught: unknown) => {
      setError(
        caught instanceof ApiError ? caught.message : 'Não foi possível inscrever o jogador.',
      );
    },
  });

  function openConfirmRegister(member: ClubeMembershipDto) {
    setConfirmStaffBonus(false);
    setConfirmingMember(member);
  }

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

  const unregisterMutation = useMutation({
    mutationFn: () => tournamentApi.unregisterEntry(tournamentId, crypto.randomUUID()),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (caught: unknown) => {
      setError(
        caught instanceof ApiError ? caught.message : 'Não foi possível cancelar a inscrição.',
      );
    },
  });

  const unregisterForUserMutation = useMutation({
    mutationFn: (userId: string) =>
      tournamentApi.unregisterEntryForUser(tournamentId, userId, crypto.randomUUID()),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (caught: unknown) => {
      setError(
        caught instanceof ApiError ? caught.message : 'Não foi possível cancelar a inscrição.',
      );
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

  // REFUNDED não conta como "estou inscrito" — mesmo critério do backend
  // (`previousEntries`/`assertRegistrationAllowed` excluem REFUNDED): quem
  // cancelou pode ver o próprio card de "Inscrever-se" de novo, não uma
  // mensagem de inscrito fantasma numa inscrição que já foi estornada.
  const myEntry = tournament.entries.find(
    (e) => e.userId === user?.id && e.status !== TournamentEntryStatus.REFUNDED,
  );
  const myTicket = myEntry ? seatLabel(myEntry) : null;
  // Janela de inscrição é a mesma pra jogador e pra admin registrando por
  // outro — só a checagem de "já inscrito" muda (admin exclui pelo alvo
  // buscado, não por `myEntry`). "Late registration": torneio já RUNNING mas
  // ainda dentro do `lateRegUntil` — mesma regra do backend
  // (`assertRegistrationAllowed`), exceto o corte por NÍVEL (o relógio não é
  // buscado nesta tela; se passou do nível o backend recusa e o erro aparece
  // no Toast normalmente).
  const lateRegOpen =
    tournament.status === TournamentStatus.RUNNING && lateRegistrationOpen(tournament.lateRegUntil);
  const registrationOpen =
    (tournament.status === TournamentStatus.REGISTERING || lateRegOpen) &&
    tournament.registeredPlayers < tournament.maxPlayers;
  const canRegister = !myEntry && registrationOpen;
  // Mesma janela do backend (`unregisterEntry`): só antes do torneio começar
  // — depois disso a ficha pode ter mudado de mãos na mesa, e "desistir"
  // vira eliminação de verdade (decisão do staff, não um botão do jogador).
  const canUnregister =
    myEntry?.status === TournamentEntryStatus.REGISTERED &&
    tournament.status === TournamentStatus.REGISTERING;

  const registeredUserIds = new Set(tournament.entries.map((e) => e.userId));
  const memberQuery = memberSearch.trim().toLowerCase();
  const memberCandidates = (members ?? []).filter((member) => {
    if (member.status !== ClubeMembershipStatus.ACTIVE) return false;
    if (registeredUserIds.has(member.userId)) return false;
    if (!memberQuery) return false;
    return (
      member.name.toLowerCase().includes(memberQuery) ||
      member.email.toLowerCase().includes(memberQuery) ||
      (member.document?.includes(memberQuery) ?? false)
    );
  });
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
        {canUnregister && (
          <Button
            className="mt-3"
            variant="ghost"
            fullWidth
            loading={unregisterMutation.isPending}
            onClick={() => unregisterMutation.mutate()}
          >
            Cancelar inscrição
          </Button>
        )}

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

      {isAdmin && registrationOpen && (
        <Card title="Inscrever jogador">
          <p className="text-sm text-muted">
            Busque um membro já cadastrado no clube por nome, e-mail ou CPF para inscrevê-lo em nome
            dele — o buy-in sai da carteira do jogador, não da sua.
          </p>
          <Input
            className="mt-3"
            placeholder="Nome, e-mail ou CPF"
            value={memberSearch}
            onChange={(e) => setMemberSearch(e.target.value)}
          />
          {memberSearch.trim() && (
            <ul className="mt-3 flex flex-col gap-2 divide-y divide-border">
              {memberCandidates.length === 0 ? (
                <li className="pt-2 text-sm text-muted">Nenhum membro encontrado.</li>
              ) : (
                memberCandidates.map((member) => (
                  <li
                    key={member.userId}
                    className="flex items-center justify-between gap-2 pt-2 first:pt-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{member.name}</p>
                      <p className="truncate text-xs text-muted">{member.email}</p>
                    </div>
                    <Button size="sm" onClick={() => openConfirmRegister(member)}>
                      Inscrever
                    </Button>
                  </li>
                ))
              )}
            </ul>
          )}
        </Card>
      )}

      <Dialog
        open={confirmingMember !== null}
        onClose={() => setConfirmingMember(null)}
        title="Confirmar inscrição"
        footer={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmingMember(null)}
              disabled={registerForUserMutation.isPending}
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              loading={registerForUserMutation.isPending}
              onClick={() => registerForUserMutation.mutate(confirmingMember!.userId)}
            >
              Confirmar inscrição
            </Button>
          </>
        }
      >
        {confirmingMember && (
          <div className="flex flex-col gap-3 text-foreground">
            <p>
              Inscrever <span className="font-medium">{confirmingMember.name}</span> (
              {confirmingMember.email}) em <span className="font-medium">{tournament.name}</span>.
            </p>
            <dl className="flex flex-col gap-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted">Buy-in</dt>
                <dd className="font-ledger">{formatMoneySafe(tournament.buyIn)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Taxa</dt>
                <dd className="font-ledger">{formatMoneySafe(tournament.fee)}</dd>
              </div>
            </dl>
            {tournament.staffBonusCost && (
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--accent)]"
                  checked={confirmStaffBonus}
                  onChange={(e) => setConfirmStaffBonus(e.target.checked)}
                />
                Bônus de staff ({formatMoneySafe(tournament.staffBonusCost)} → +
                {tournament.staffBonusChips} fichas)
              </label>
            )}
            <p className="text-xs text-muted">
              O valor sai da carteira do próprio jogador, não da sua.
            </p>
          </div>
        )}
      </Dialog>

      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[1fr_1.5fr] lg:items-start lg:gap-4">
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
                        // Antes do torneio começar, cancelar (com reembolso)
                        // é a ação certa — "Eliminar" não devolve dinheiro e
                        // é decisão de jogo, não de inscrição.
                        canUnregister={tournament.status === TournamentStatus.REGISTERING}
                        onUnregister={() => unregisterForUserMutation.mutate(entry.userId)}
                        unregistering={
                          unregisterForUserMutation.isPending &&
                          unregisterForUserMutation.variables === entry.userId
                        }
                      />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
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
  canUnregister: boolean;
  onUnregister: () => void;
  unregistering: boolean;
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
  canUnregister,
  onUnregister,
  unregistering,
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
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={onStartEliminate}>
                Eliminar
              </Button>
              {canUnregister && (
                <Button size="sm" variant="ghost" loading={unregistering} onClick={onUnregister}>
                  Cancelar inscrição
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </li>
  );
}
