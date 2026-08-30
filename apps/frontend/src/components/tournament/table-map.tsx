'use client';

import { TournamentTableStatus, ClubeRole } from '@poker-system/shared';
import type { PublicTournamentSeatDto, PublicTournamentTableDto } from '@poker-system/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useSession } from '@/components/providers/session-provider';
import { tournamentApi } from '@/lib/api/tournament';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Skeleton,
  Toast,
} from '@/components/ui';
import { ApiError } from '@/lib/http-client';

const POLL_INTERVAL_MS = 3_000;

/**
 * Mapa de mesas do torneio (staff).
 *
 * Lê do endpoint PÚBLICO (`getTableMap`, o mesmo da TV): o payload não traz
 * `userId`, mas traz `entryId`, que é a chave que `eliminateEntry` pede — nada
 * nesta tela precisa de `userId`. `redraw` devolve o mapa "rico" (com
 * `userId`); em vez de normalizar os dois shapes, a mutação só invalida a
 * query e deixa o refetch trazer o payload público de novo.
 *
 * Não reusa `components/table/seat-grid.tsx`: aquele é de cash game — busca os
 * próprios dados por `tableId`, tem assento vago com sessão/stack em dinheiro
 * e diálogo de buy-in/cash-out. Aqui os assentos vêm prontos no mapa, só
 * existem ocupados e o stack é em fichas.
 */
export function TableMap({ tournamentId }: { tournamentId: string }) {
  const { clubeRole } = useSession();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [confirmingRedraw, setConfirmingRedraw] = useState(false);
  const [eliminating, setEliminating] = useState<PublicTournamentSeatDto | null>(null);

  const {
    data: map,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['tournaments', tournamentId, 'tables'],
    queryFn: () => tournamentApi.getTableMap(tournamentId),
    refetchInterval: POLL_INTERVAL_MS,
  });

  // Prefixo: invalida o mapa de mesas E o detalhe do torneio
  // (`['tournaments', id]`), que muda junto — eliminar altera as inscrições.
  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['tournaments', tournamentId] });
  }

  const redrawMutation = useMutation({
    mutationFn: () => tournamentApi.redraw(tournamentId),
    onSuccess: () => {
      setError(null);
      setConfirmingRedraw(false);
      invalidate();
    },
    onError: (caught: unknown) => {
      setConfirmingRedraw(false);
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível sortear as mesas.');
    },
  });

  const eliminateMutation = useMutation({
    // Sem `finalPosition`: o backend não infere colocação e o staff a define
    // no detalhe do torneio; aqui a ação é só tirar o jogador da mesa.
    mutationFn: (entryId: string) => tournamentApi.eliminateEntry(tournamentId, entryId, {}),
    onSuccess: () => {
      setError(null);
      setEliminating(null);
      invalidate();
    },
    onError: (caught: unknown) => {
      setEliminating(null);
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível eliminar.');
    },
  });

  if (isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-40 w-full rounded-lg" />
        ))}
      </div>
    );
  }
  if (isError || !map) {
    return <ErrorState description="Não foi possível carregar as mesas." />;
  }

  const isAdmin = clubeRole === ClubeRole.ADMIN;

  return (
    <div className="flex flex-col gap-4">
      {error && <Toast type="error" message={error} />}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-ledger text-sm text-muted">
            {map.tables.length} mesas · {map.playersRemaining} jogadores · stack médio{' '}
            {map.averageStack.toLocaleString('pt-BR')}
          </p>
          {isAdmin && (
            <Button size="sm" variant="secondary" onClick={() => setConfirmingRedraw(true)}>
              Redraw manual
            </Button>
          )}
        </div>
      </Card>

      {map.tables.length === 0 ? (
        <EmptyState
          title="Nenhuma mesa"
          description="As mesas aparecem aqui depois do primeiro sorteio."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {map.tables.map((table) => (
            <TableCard
              key={table.id}
              table={table}
              isAdmin={isAdmin}
              onEliminate={setEliminating}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirmingRedraw}
        title="Sortear as mesas de novo?"
        description="Todos os jogadores vivos são redistribuídos — os assentos atuais são perdidos."
        confirmLabel="Sim, fazer redraw"
        loading={redrawMutation.isPending}
        onConfirm={() => redrawMutation.mutate()}
        onCancel={() => setConfirmingRedraw(false)}
      />

      <ConfirmDialog
        open={eliminating !== null}
        title={eliminating ? `Eliminar ${eliminating.userName}?` : ''}
        description="O jogador sai da mesa e a inscrição é encerrada."
        confirmLabel="Sim, eliminar"
        danger
        loading={eliminateMutation.isPending}
        onConfirm={() => eliminating && eliminateMutation.mutate(eliminating.entryId)}
        onCancel={() => setEliminating(null)}
      />
    </div>
  );
}

interface TableCardProps {
  table: PublicTournamentTableDto;
  isAdmin: boolean;
  onEliminate: (seat: PublicTournamentSeatDto) => void;
}

function TableCard({ table, isAdmin, onEliminate }: TableCardProps) {
  const closed = table.status === TournamentTableStatus.CLOSED;

  return (
    <Card className={closed ? 'opacity-60' : undefined}>
      <div className="flex items-center justify-between gap-2">
        <p className="font-display text-lg font-semibold">Mesa {table.tableNumber}</p>
        {closed ? (
          <Badge variant="neutral">Fechada</Badge>
        ) : (
          <Badge variant={table.seats.length === table.capacity ? 'warning' : 'info'}>
            {table.seats.length}/{table.capacity}
          </Badge>
        )}
      </div>

      {table.seats.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Sem jogadores.</p>
      ) : (
        <ul className="mt-2 flex flex-col divide-y divide-border">
          {table.seats.map((seat) => (
            <li key={seat.entryId} className="flex items-center gap-2 py-2 first:pt-0 last:pb-0">
              <span className="w-6 shrink-0 font-mono text-xs text-muted">{seat.seatNumber}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{seat.userName}</span>
              <span className="font-ledger shrink-0 text-sm">
                {seat.chipStack.toLocaleString('pt-BR')}
              </span>
              {isAdmin && (
                <Button size="sm" variant="ghost" onClick={() => onEliminate(seat)}>
                  Eliminar
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
