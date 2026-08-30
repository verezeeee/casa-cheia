'use client';

import type { TableSeatDto } from '@poker-system/shared';
import { ClubeRole } from '@poker-system/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { useState, type CSSProperties, type FormEvent } from 'react';
import { useSession } from '@/components/providers/session-provider';
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

  // Deriva do resultado ao vivo da query em vez de guardar uma cópia do
  // assento no estado: depois de um ajuste de stack, o diálogo mostra o
  // valor atualizado assim que o poll seguinte chega, sem sincronizar nada
  // manualmente.
  const dialogSeat = seats?.find((seat) => seat.seatNumber === selectedSeatNumber) ?? null;

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['tables', tableId, 'seats'] });
    void queryClient.invalidateQueries({ queryKey: ['tables'] });
    void queryClient.invalidateQueries({ queryKey: ['wallet', 'balance'] });
  }

  function closeSeatDialog() {
    setSelectedSeatNumber(null);
    setBuyInAmount('');
    setAdjustAmount('');
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

  const isAdmin = clubeRole === ClubeRole.ADMIN;

  return (
    <div className="flex flex-col gap-4">
      {error && <Toast type="error" message={error} />}

      {isAdmin && (
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
            adjustAmount={adjustAmount}
            onAdjustAmountChange={setAdjustAmount}
            onSubmitAdjust={handleAdjustSubmit}
            adjusting={adjustMutation.isPending}
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
  adjustAmount: string;
  onAdjustAmountChange: (value: string) => void;
  onSubmitAdjust: (event: FormEvent<HTMLFormElement>) => void;
  adjusting: boolean;
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
  adjustAmount,
  onAdjustAmountChange,
  onSubmitAdjust,
  adjusting,
}: SeatDialogBodyProps) {
  const vacant = seat.userId === null;

  if (vacant) {
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
        <form onSubmit={onSubmitAdjust} className="flex flex-col gap-2 border-t border-border pt-3">
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
      )}
    </div>
  );
}
