'use client';

import type { TableSeatDto } from '@poker-system/shared';
import { UserRole } from '@poker-system/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useSession } from '@/components/providers/session-provider';
import { tableApi } from '@/lib/api/table';
import { Badge, Button, Card, Input, Spinner, Toast } from '@/components/ui';
import { ApiError } from '@/lib/http-client';
import { formatMoneySafe } from '@/lib/format';

const POLL_INTERVAL_MS = 5_000;

export function SeatGrid({ tableId }: { tableId: string }) {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [openSeat, setOpenSeat] = useState<number | null>(null);
  const [buyInAmount, setBuyInAmount] = useState('');
  const [adjustSeat, setAdjustSeat] = useState<string | null>(null);
  const [adjustAmount, setAdjustAmount] = useState('');

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

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['tables', tableId, 'seats'] });
    void queryClient.invalidateQueries({ queryKey: ['tables'] });
    void queryClient.invalidateQueries({ queryKey: ['wallet', 'balance'] });
  }

  const sitMutation = useMutation({
    mutationFn: (seatNumber: number) =>
      tableApi.sitAtTable(tableId, { seatNumber, buyInAmount }, crypto.randomUUID()),
    onSuccess: () => {
      setError(null);
      setOpenSeat(null);
      setBuyInAmount('');
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
      setAdjustSeat(null);
      setAdjustAmount('');
      invalidate();
    },
    onError: (caught: unknown) => {
      setError(
        caught instanceof ApiError ? caught.message : 'Não foi possível registrar o ajuste.',
      );
    },
  });

  function handleSit(event: FormEvent<HTMLFormElement>, seatNumber: number) {
    event.preventDefault();
    sitMutation.mutate(seatNumber);
  }

  function handleAdjust(event: FormEvent<HTMLFormElement>, sessionId: string) {
    event.preventDefault();
    adjustMutation.mutate(sessionId);
  }

  if (isLoading) return <Spinner size="sm" label="Carregando assentos" />;
  if (isError || !seats) {
    return <p className="text-red-600 dark:text-red-400">Não foi possível carregar os assentos.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <Toast type="error" message={error} />}

      <ul className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
        {seats.map((seat) => (
          <li key={seat.seatNumber}>
            <SeatCard
              seat={seat}
              isMine={seat.userId === user?.id}
              isAdmin={user?.role === UserRole.ADMIN}
              isOpen={openSeat === seat.seatNumber}
              buyInAmount={buyInAmount}
              onBuyInAmountChange={setBuyInAmount}
              onToggleSit={() => setOpenSeat(openSeat === seat.seatNumber ? null : seat.seatNumber)}
              onSubmitSit={(e) => handleSit(e, seat.seatNumber)}
              sitting={sitMutation.isPending}
              onCashOut={() => seat.sessionId && cashOutMutation.mutate(seat.sessionId)}
              cashingOut={cashOutMutation.isPending}
              isAdjusting={adjustSeat === seat.sessionId}
              adjustAmount={adjustAmount}
              onAdjustAmountChange={setAdjustAmount}
              onToggleAdjust={() =>
                setAdjustSeat(adjustSeat === seat.sessionId ? null : seat.sessionId)
              }
              onSubmitAdjust={(e) => seat.sessionId && handleAdjust(e, seat.sessionId)}
              adjusting={adjustMutation.isPending}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

interface SeatCardProps {
  seat: TableSeatDto;
  isMine: boolean;
  isAdmin: boolean;
  isOpen: boolean;
  buyInAmount: string;
  onBuyInAmountChange: (value: string) => void;
  onToggleSit: () => void;
  onSubmitSit: (event: FormEvent<HTMLFormElement>) => void;
  sitting: boolean;
  onCashOut: () => void;
  cashingOut: boolean;
  isAdjusting: boolean;
  adjustAmount: string;
  onAdjustAmountChange: (value: string) => void;
  onToggleAdjust: () => void;
  onSubmitAdjust: (event: FormEvent<HTMLFormElement>) => void;
  adjusting: boolean;
}

function SeatCard({
  seat,
  isMine,
  isAdmin,
  isOpen,
  buyInAmount,
  onBuyInAmountChange,
  onToggleSit,
  onSubmitSit,
  sitting,
  onCashOut,
  cashingOut,
  isAdjusting,
  adjustAmount,
  onAdjustAmountChange,
  onToggleAdjust,
  onSubmitAdjust,
  adjusting,
}: SeatCardProps) {
  const vacant = seat.userId === null;

  return (
    <Card>
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
          Assento {seat.seatNumber}
        </p>
        {!vacant && (
          <Badge variant={isMine ? 'success' : 'neutral'}>{isMine ? 'Você' : 'Ocupado'}</Badge>
        )}
      </div>

      {vacant ? (
        <div className="mt-2">
          {isOpen ? (
            <form onSubmit={onSubmitSit} className="flex flex-col gap-2">
              <Input
                inputMode="decimal"
                placeholder="Valor do buy-in"
                required
                value={buyInAmount}
                onChange={(e) => onBuyInAmountChange(e.target.value)}
              />
              <div className="flex gap-2">
                <Button type="submit" size="sm" loading={sitting}>
                  Confirmar
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={onToggleSit}>
                  Cancelar
                </Button>
              </div>
            </form>
          ) : (
            <Button size="sm" variant="secondary" onClick={onToggleSit}>
              Sentar
            </Button>
          )}
        </div>
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          <p className="font-semibold">{seat.userName}</p>
          <p className="text-lg">{formatMoneySafe(seat.currentStack ?? '0')}</p>

          {isMine && (
            <Button size="sm" variant="secondary" loading={cashingOut} onClick={onCashOut}>
              Cash-out
            </Button>
          )}

          {isAdmin && !isMine && (
            <>
              {isAdjusting ? (
                <form onSubmit={onSubmitAdjust} className="flex flex-col gap-2">
                  <Input
                    inputMode="decimal"
                    placeholder="+25.00 ou -25.00"
                    required
                    value={adjustAmount}
                    onChange={(e) => onAdjustAmountChange(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <Button type="submit" size="sm" loading={adjusting}>
                      Aplicar
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={onToggleAdjust}>
                      Cancelar
                    </Button>
                  </div>
                </form>
              ) : (
                <Button size="sm" variant="ghost" onClick={onToggleAdjust}>
                  Ajustar stack (resultado de mão)
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </Card>
  );
}
