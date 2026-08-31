'use client';

import type { ClubeMembershipDto, TableSeatDto } from '@poker-system/shared';
import { ClubeMembershipStatus, ClubeRole, TableStatus } from '@poker-system/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { useState, type CSSProperties, type FormEvent } from 'react';
import { useSession } from '@/components/providers/session-provider';
import { clubMembersApi } from '@/lib/api/club';
import { tableApi } from '@/lib/api/table';
import {
  Button,
  cn,
  ConfirmDialog,
  Dialog,
  ErrorState,
  Input,
  Skeleton,
  Toast,
} from '@/components/ui';
import { ApiError } from '@/lib/http-client';
import { formatMoneySafe } from '@/lib/format';

const POLL_INTERVAL_MS = 5_000;

/**
 * Posição de um assento ao redor da elipse, em porcentagem do container
 * (raio menor que 50% pra sobrar "rail" entre o feltro e os assentos —
 * ver `inset-*` do feltro abaixo). Só faz sentido em `sm:`+: em telas
 * estreitas os assentos viram lista vertical simples (ver className dos
 * chips), então a posição é ignorada — `left`/`top` não têm efeito num
 * elemento `position: static`.
 */
function seatPosition(index: number, total: number): CSSProperties {
  const angle = (2 * Math.PI * index) / total - Math.PI / 2;
  return {
    left: `${50 + 44 * Math.cos(angle)}%`,
    top: `${50 + 42 * Math.sin(angle)}%`,
  };
}

export function SeatGrid({ tableId }: { tableId: string }) {
  const { user, clubeRole } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [selectedSeatNumber, setSelectedSeatNumber] = useState<number | null>(null);
  const [buyInAmount, setBuyInAmount] = useState('');
  const [adjustAmount, setAdjustAmount] = useState('');
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [seatMode, setSeatMode] = useState<'self' | 'member' | 'guest'>('self');
  const [memberSearch, setMemberSearch] = useState('');
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');

  // Só ADMIN pode sentar outro membro/convidado — o backend também recusa
  // (403) pra quem não é, mas a query nem dispara pros outros papéis (mesmo
  // padrão de `tournament-detail.tsx`). Calculado ANTES dos `return`
  // antecipados de loading/erro abaixo — hook não pode vir depois deles.
  const isAdmin = clubeRole === ClubeRole.ADMIN;

  const {
    data: seats,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['tables', tableId, 'seats'],
    queryFn: () => tableApi.getSeats(tableId),
    // Sem push em tempo real (WebSocket) nesta fase do MVP — poll simples
    // basta para refletir buy-ins/cash-outs de outros jogadores na mesa.
    refetchInterval: POLL_INTERVAL_MS,
  });

  // Só pra saber o `status` da mesa (ex: esconder "Fechar mesa" numa mesa já
  // fechada — `getSeats` não carrega isso, só a grade de assentos). Mesma
  // `queryKey` prefix de `['tables', tableId, 'seats']`, então `invalidate()`
  // já pega essa query também (invalidação por prefixo).
  const { data: table } = useQuery({
    queryKey: ['tables', tableId],
    queryFn: () => tableApi.getTable(tableId),
    refetchInterval: POLL_INTERVAL_MS,
  });

  const { data: members } = useQuery({
    queryKey: ['clube', 'members'],
    queryFn: () => clubMembersApi.listMembers(),
    enabled: isAdmin,
  });

  // Deriva do resultado ao vivo da query em vez de guardar uma cópia do
  // assento no estado: depois de um ajuste de stack, o diálogo mostra o
  // valor atualizado assim que o poll seguinte chega, sem sincronizar nada
  // manualmente.
  const dialogSeat = seats?.find((seat) => seat.seatNumber === selectedSeatNumber) ?? null;

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['tables', tableId, 'seats'] });
    void queryClient.invalidateQueries({ queryKey: ['tables'] });
    void queryClient.invalidateQueries({ queryKey: ['wallet', 'balance'] });
    void queryClient.invalidateQueries({ queryKey: ['clube', 'members'] });
  }

  function closeSeatDialog() {
    setSelectedSeatNumber(null);
    setBuyInAmount('');
    setAdjustAmount('');
    setSeatMode('self');
    setMemberSearch('');
    setGuestName('');
    setGuestPhone('');
  }

  const sitMutation = useMutation({
    mutationFn: (seatNumber: number) =>
      tableApi.sitAtTable(tableId, { seatNumber, buyInAmount }, crypto.randomUUID()),
    onSuccess: () => {
      setError(null);
      closeSeatDialog();
      invalidate();
    },
    onError: (caught: unknown) => {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível sentar na mesa.');
    },
  });

  const sitForUserMutation = useMutation({
    mutationFn: (userId: string) =>
      tableApi.sitAtTableForUser(
        tableId,
        userId,
        { seatNumber: dialogSeat!.seatNumber, buyInAmount },
        crypto.randomUUID(),
      ),
    onSuccess: () => {
      setError(null);
      closeSeatDialog();
      invalidate();
    },
    onError: (caught: unknown) => {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível sentar o jogador.');
    },
  });

  const sitGuestMutation = useMutation({
    mutationFn: () =>
      tableApi.sitGuestAtTable(
        tableId,
        { seatNumber: dialogSeat!.seatNumber, buyInAmount, name: guestName, phone: guestPhone },
        crypto.randomUUID(),
      ),
    onSuccess: () => {
      setError(null);
      closeSeatDialog();
      invalidate();
    },
    onError: (caught: unknown) => {
      setError(
        caught instanceof ApiError ? caught.message : 'Não foi possível sentar o convidado.',
      );
    },
  });

  const cashOutMutation = useMutation({
    mutationFn: (sessionId: string) => tableApi.cashOut(tableId, sessionId, crypto.randomUUID()),
    onSuccess: () => {
      setError(null);
      closeSeatDialog();
      invalidate();
    },
    onError: (caught: unknown) => {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível fazer cash-out.');
    },
  });

  const adminCashOutMutation = useMutation({
    mutationFn: (sessionId: string) =>
      tableApi.cashOutAsAdmin(tableId, sessionId, crypto.randomUUID()),
    onSuccess: () => {
      setError(null);
      closeSeatDialog();
      invalidate();
    },
    onError: (caught: unknown) => {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível fazer o cash-out.');
    },
  });

  const adjustMutation = useMutation({
    mutationFn: (sessionId: string) =>
      tableApi.recordMovement(tableId, sessionId, { amount: adjustAmount, reason: 'HAND_RESULT' }),
    onSuccess: () => {
      setError(null);
      setAdjustAmount('');
      invalidate();
    },
    onError: (caught: unknown) => {
      setError(
        caught instanceof ApiError ? caught.message : 'Não foi possível registrar o ajuste.',
      );
    },
  });

  const closeMutation = useMutation({
    mutationFn: () => tableApi.closeTable(tableId),
    onSuccess: () => {
      setError(null);
      invalidate();
      router.push('/lobby');
    },
    onError: (caught: unknown) => {
      setConfirmingClose(false);
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível fechar a mesa.');
    },
  });

  function handleSitSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (dialogSeat) sitMutation.mutate(dialogSeat.seatNumber);
  }

  function handleAdjustSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (dialogSeat?.sessionId) adjustMutation.mutate(dialogSeat.sessionId);
  }

  function handleGuestSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    sitGuestMutation.mutate();
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }
  if (isError || !seats) {
    return <ErrorState description="Não foi possível carregar os assentos." />;
  }

  // Convidados nunca podem ser sentados de novo por busca (não têm CPF/e-mail
  // reais pra procurar) e quem já está sentado NESTA mesa some da lista —
  // mesmo filtro de `tournament-detail.tsx` (`registeredUserIds`), adaptado
  // pra "sentado nesta mesa" em vez de "inscrito no torneio".
  const seatedUserIds = new Set(
    seats.map((s) => s.userId).filter((id): id is string => id !== null),
  );
  const memberQuery = memberSearch.trim().toLowerCase();
  const memberCandidates = (members ?? []).filter((member: ClubeMembershipDto) => {
    if (member.status !== ClubeMembershipStatus.ACTIVE) return false;
    if (member.isGuest) return false;
    if (seatedUserIds.has(member.userId)) return false;
    if (!memberQuery) return false;
    return (
      member.name.toLowerCase().includes(memberQuery) ||
      member.email.toLowerCase().includes(memberQuery) ||
      (member.document?.includes(memberQuery) ?? false)
    );
  });

  return (
    <div className="flex flex-col gap-4">
      {error && <Toast type="error" message={error} />}

      {isAdmin && table && table.status !== TableStatus.CLOSED && (
        <>
          <Button
            size="sm"
            variant="danger"
            onClick={() => setConfirmingClose(true)}
            className="self-end"
          >
            Fechar mesa
          </Button>
          <ConfirmDialog
            open={confirmingClose}
            title="Fechar a mesa?"
            description="Isso faz cash-out de todos os jogadores sentados."
            confirmLabel="Sim, fechar mesa"
            danger
            loading={closeMutation.isPending}
            onConfirm={() => closeMutation.mutate()}
            onCancel={() => setConfirmingClose(false)}
          />
        </>
      )}

      {/* Elipse de feltro (decorativa) + assentos ao redor, em sm:+. Em
          telas estreitas os assentos ficam em fluxo normal (lista), o
          feltro some — uma mesa "de cima" não cabe legível em 375px. */}
      <div className="relative sm:aspect-[16/10] sm:min-h-[380px]">
        <div
          aria-hidden="true"
          className="absolute inset-[14%] hidden rounded-[50%] bg-brand shadow-inner sm:block"
        />
        <div className="flex flex-col gap-2 sm:contents">
          {seats.map((seat, index) => (
            <SeatChip
              key={seat.seatNumber}
              seat={seat}
              isMine={seat.userId === user?.id}
              onSelect={() => setSelectedSeatNumber(seat.seatNumber)}
              style={seatPosition(index, seats.length)}
              index={index}
            />
          ))}
        </div>
      </div>

      <Dialog
        open={dialogSeat !== null}
        onClose={closeSeatDialog}
        title={dialogSeat ? `Assento ${dialogSeat.seatNumber}` : ''}
      >
        {dialogSeat && (
          <SeatDialogBody
            seat={dialogSeat}
            isMine={dialogSeat.userId === user?.id}
            isAdmin={isAdmin}
            buyInAmount={buyInAmount}
            onBuyInAmountChange={setBuyInAmount}
            onSubmitSit={handleSitSubmit}
            sitting={sitMutation.isPending}
            onCashOut={() => dialogSeat.sessionId && cashOutMutation.mutate(dialogSeat.sessionId)}
            cashingOut={cashOutMutation.isPending}
            onAdminCashOut={() =>
              dialogSeat.sessionId && adminCashOutMutation.mutate(dialogSeat.sessionId)
            }
            adminCashingOut={adminCashOutMutation.isPending}
            adjustAmount={adjustAmount}
            onAdjustAmountChange={setAdjustAmount}
            onSubmitAdjust={handleAdjustSubmit}
            adjusting={adjustMutation.isPending}
            seatMode={seatMode}
            onSeatModeChange={setSeatMode}
            memberSearch={memberSearch}
            onMemberSearchChange={setMemberSearch}
            memberCandidates={memberCandidates}
            onSitForUser={(userId) => sitForUserMutation.mutate(userId)}
            sittingForUser={sitForUserMutation.isPending}
            guestName={guestName}
            onGuestNameChange={setGuestName}
            guestPhone={guestPhone}
            onGuestPhoneChange={setGuestPhone}
            onSubmitGuest={handleGuestSubmit}
            sittingGuest={sitGuestMutation.isPending}
          />
        )}
      </Dialog>
    </div>
  );
}

interface SeatChipProps {
  seat: TableSeatDto;
  isMine: boolean;
  onSelect: () => void;
  style: CSSProperties;
  index: number;
}

/**
 * Um assento — botão único que abre o diálogo de ação (sentar/cash-out/
 * ajuste). `sm:absolute` com a posição vinda de `seatPosition` desenha a
 * mesa em elipse; sem essa classe (mobile) o `style` de posição é ignorado
 * (não tem efeito em `position: static`) e o botão flui como item de lista.
 *
 * Entrada com stagger por `index` — só `opacity` (não `scale`/`x`/`y`):
 * o framer-motion gerencia `transform` inline quando anima essas
 * propriedades, o que atropelaria as classes `sm:-translate-x-1/2
 * sm:-translate-y-1/2` que centralizam o chip no ponto calculado. Como o
 * `key` é `seat.seatNumber` (estável entre polls de 5s), a animação de
 * montagem dispara uma vez só, não a cada refetch.
 */
function SeatChip({ seat, isMine, onSelect, style, index }: SeatChipProps) {
  const vacant = seat.userId === null;
  const label = vacant
    ? `Assento ${seat.seatNumber}, vago`
    : `Assento ${seat.seatNumber}, ${seat.userName}${isMine ? ' (você)' : ''}, ${formatMoneySafe(seat.currentStack ?? '0')}`;

  return (
    <motion.button
      type="button"
      onClick={onSelect}
      style={style}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: index * 0.04, duration: 0.3 }}
      aria-haspopup="dialog"
      aria-label={label}
      className={cn(
        'rounded-lg border p-2.5 text-center transition-all duration-300 hover:scale-[1.02] active:scale-95',
        'sm:absolute sm:w-24 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:hover:z-10 sm:hover:scale-110',
        vacant
          ? 'border-dashed border-border bg-surface/70 text-muted hover:border-accent hover:text-accent'
          : 'border-border bg-surface shadow-sm',
        isMine && 'border-accent',
      )}
    >
      <p className="font-mono text-[10px] tracking-wide text-muted uppercase">
        Assento {seat.seatNumber}
      </p>
      {vacant ? (
        <p className="mt-1 text-xs font-semibold">Sentar</p>
      ) : (
        <>
          <p className="mt-1 truncate text-xs font-semibold">{seat.userName}</p>
          <p className="font-ledger text-xs text-muted">
            {formatMoneySafe(seat.currentStack ?? '0')}
          </p>
          {isMine && <p className="text-[10px] font-semibold text-accent">Você</p>}
        </>
      )}
    </motion.button>
  );
}

type SeatMode = 'self' | 'member' | 'guest';

const SEAT_MODE_LABEL: Record<SeatMode, string> = {
  self: 'Eu',
  member: 'Membro do clube',
  guest: 'Sem cadastro',
};

interface SeatDialogBodyProps {
  seat: TableSeatDto;
  isMine: boolean;
  isAdmin: boolean;
  buyInAmount: string;
  onBuyInAmountChange: (value: string) => void;
  onSubmitSit: (event: FormEvent<HTMLFormElement>) => void;
  sitting: boolean;
  onCashOut: () => void;
  cashingOut: boolean;
  onAdminCashOut: () => void;
  adminCashingOut: boolean;
  adjustAmount: string;
  onAdjustAmountChange: (value: string) => void;
  onSubmitAdjust: (event: FormEvent<HTMLFormElement>) => void;
  adjusting: boolean;
  seatMode: SeatMode;
  onSeatModeChange: (mode: SeatMode) => void;
  memberSearch: string;
  onMemberSearchChange: (value: string) => void;
  memberCandidates: ClubeMembershipDto[];
  onSitForUser: (userId: string) => void;
  sittingForUser: boolean;
  guestName: string;
  onGuestNameChange: (value: string) => void;
  guestPhone: string;
  onGuestPhoneChange: (value: string) => void;
  onSubmitGuest: (event: FormEvent<HTMLFormElement>) => void;
  sittingGuest: boolean;
}

function SeatDialogBody({
  seat,
  isMine,
  isAdmin,
  buyInAmount,
  onBuyInAmountChange,
  onSubmitSit,
  sitting,
  onCashOut,
  cashingOut,
  onAdminCashOut,
  adminCashingOut,
  adjustAmount,
  onAdjustAmountChange,
  onSubmitAdjust,
  adjusting,
  seatMode,
  onSeatModeChange,
  memberSearch,
  onMemberSearchChange,
  memberCandidates,
  onSitForUser,
  sittingForUser,
  guestName,
  onGuestNameChange,
  guestPhone,
  onGuestPhoneChange,
  onSubmitGuest,
  sittingGuest,
}: SeatDialogBodyProps) {
  const vacant = seat.userId === null;

  if (vacant) {
    // Não-admin nunca vê o seletor — só pode sentar a si mesmo, exatamente
    // como antes desta feature.
    if (!isAdmin) {
      return (
        <form onSubmit={onSubmitSit} className="flex flex-col gap-3">
          <Input
            inputMode="decimal"
            placeholder="Valor do buy-in"
            required
            value={buyInAmount}
            onChange={(e) => onBuyInAmountChange(e.target.value)}
          />
          <Button type="submit" loading={sitting} fullWidth>
            Confirmar
          </Button>
        </form>
      );
    }

    return (
      <div className="flex flex-col gap-3">
        {/* Mesmo idioma visual do seletor de 3 modos de `app/register/page.tsx`. */}
        <div className="flex flex-wrap gap-2">
          {(Object.keys(SEAT_MODE_LABEL) as SeatMode[]).map((mode) => (
            <Button
              key={mode}
              type="button"
              size="sm"
              variant={seatMode === mode ? 'secondary' : 'ghost'}
              onClick={() => onSeatModeChange(mode)}
            >
              {SEAT_MODE_LABEL[mode]}
            </Button>
          ))}
        </div>

        {seatMode === 'self' && (
          <form onSubmit={onSubmitSit} className="flex flex-col gap-3">
            <Input
              inputMode="decimal"
              placeholder="Valor do buy-in"
              required
              value={buyInAmount}
              onChange={(e) => onBuyInAmountChange(e.target.value)}
            />
            <Button type="submit" loading={sitting} fullWidth>
              Confirmar
            </Button>
          </form>
        )}

        {seatMode === 'member' && (
          <div className="flex flex-col gap-3">
            <Input
              inputMode="decimal"
              placeholder="Valor do buy-in"
              required
              value={buyInAmount}
              onChange={(e) => onBuyInAmountChange(e.target.value)}
            />
            <Input
              placeholder="Nome, e-mail ou CPF"
              value={memberSearch}
              onChange={(e) => onMemberSearchChange(e.target.value)}
            />
            {memberSearch.trim() && (
              <ul className="flex flex-col gap-2 divide-y divide-border">
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
                      <Button
                        size="sm"
                        disabled={!buyInAmount}
                        loading={sittingForUser}
                        onClick={() => onSitForUser(member.userId)}
                      >
                        Sentar
                      </Button>
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>
        )}

        {seatMode === 'guest' && (
          <form onSubmit={onSubmitGuest} className="flex flex-col gap-3">
            <Input
              placeholder="Nome do jogador"
              required
              value={guestName}
              onChange={(e) => onGuestNameChange(e.target.value)}
            />
            <Input
              inputMode="numeric"
              placeholder="Telefone (DDD + número)"
              required
              value={guestPhone}
              onChange={(e) => onGuestPhoneChange(e.target.value.replace(/\D/g, ''))}
            />
            <Input
              inputMode="decimal"
              placeholder="Valor do buy-in"
              required
              value={buyInAmount}
              onChange={(e) => onBuyInAmountChange(e.target.value)}
            />
            <Button type="submit" loading={sittingGuest} fullWidth>
              Confirmar
            </Button>
          </form>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="font-semibold">
          {seat.userName}
          {isMine && <span className="ml-1.5 text-xs font-medium text-accent">(você)</span>}
        </p>
        <p className="font-ledger text-lg">{formatMoneySafe(seat.currentStack ?? '0')}</p>
      </div>

      {isMine && (
        <Button variant="secondary" loading={cashingOut} onClick={onCashOut} fullWidth>
          Cash-out
        </Button>
      )}

      {isAdmin && !isMine && (
        <>
          {/* Necessário pra jogador sem cadastro: ele nunca loga, então nunca
              teria como fazer o próprio cash-out — sem isso ficaria travado
              no assento até a mesa fechar inteira. */}
          <Button variant="secondary" loading={adminCashingOut} onClick={onAdminCashOut} fullWidth>
            Cash-out (admin)
          </Button>
          <form
            onSubmit={onSubmitAdjust}
            className="flex flex-col gap-2 border-t border-border pt-3"
          >
            <p className="text-sm font-medium text-foreground">Ajustar stack (resultado de mão)</p>
            <Input
              inputMode="decimal"
              placeholder="+25.00 ou -25.00"
              required
              value={adjustAmount}
              onChange={(e) => onAdjustAmountChange(e.target.value)}
            />
            <Button type="submit" size="sm" loading={adjusting}>
              Aplicar
            </Button>
          </form>
        </>
      )}
    </div>
  );
}
