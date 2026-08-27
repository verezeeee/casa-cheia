'use client';

import { TournamentClockStatus, type TournamentClockDto } from '@poker-system/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { tournamentApi } from '@/lib/api/tournament';

/** O servidor é a fonte da verdade; o poll corrige a deriva do relógio local. */
const POLL_INTERVAL_MS = 2000;

/** Só suaviza a exibição entre dois polls — não é fonte de tempo. */
const TICK_INTERVAL_MS = 1000;

export function tournamentClockKey(tournamentId: string) {
  return ['tournaments', tournamentId, 'clock'] as const;
}

/**
 * Restante do nível corrente, em ms.
 *
 * `RUNNING`: derivado de `levelEndsAt` corrigido pelo offset — `remainingMs`
 * do payload envelhece entre polls, `levelEndsAt` não.
 * Qualquer outro estado (`PAUSED`/`NOT_STARTED`/`FINISHED`): o valor do
 * servidor, congelado. Mesmo fallback quando `levelEndsAt` vem nulo ou
 * impossível de parsear em `RUNNING` — melhor um valor velho que `NaN` na TV.
 */
function remainingFrom(clock: TournamentClockDto, offsetMs: number): number {
  if (clock.clockStatus === TournamentClockStatus.RUNNING && clock.levelEndsAt) {
    const endsAt = Date.parse(clock.levelEndsAt);
    if (!Number.isNaN(endsAt)) {
      return Math.max(0, endsAt - (Date.now() + offsetMs));
    }
  }
  return Math.max(0, clock.remainingMs);
}

/**
 * Diferença entre o relógio do servidor e o do device, medida na resposta.
 *
 * `dataUpdatedAt` é o `Date.now()` do device no instante em que ESTA resposta
 * entrou no cache — é o par correto de `serverTime`. Como o TanStack Query o
 * atualiza a cada fetch, o offset é recalculado a cada poll de graça: um
 * device derivando (TV barata ligada há semanas) reconverge a cada 2s em vez
 * de acumular erro, e nada disso precisa de efeito nem de ref.
 */
function offsetOf(clock: TournamentClockDto, dataUpdatedAt: number): number {
  const serverTime = Date.parse(clock.serverTime);
  return Number.isNaN(serverTime) ? 0 : serverTime - dataUpdatedAt;
}

/**
 * Relógio de blinds com contagem regressiva local (MT-FE-03 e MT-FE-04 usam
 * este mesmo hook — a lógica de offset/countdown não vive em nenhuma tela).
 *
 * O restante é DERIVADO no render; o `setInterval` de 1s só força o re-render
 * que redesenha os segundos (e nem existe fora de `RUNNING`, porque parado o
 * número não muda).
 */
export function useTournamentClock(tournamentId: string) {
  const query = useQuery({
    queryKey: tournamentClockKey(tournamentId),
    queryFn: () => tournamentApi.getClock(tournamentId),
    refetchInterval: POLL_INTERVAL_MS,
  });

  const clock = query.data;
  const isTicking = clock?.clockStatus === TournamentClockStatus.RUNNING && !!clock.levelEndsAt;
  const [, tick] = useState(0);

  useEffect(() => {
    if (!isTicking) return;
    const id = setInterval(() => tick((count) => count + 1), TICK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isTicking]);

  const remainingMs = clock ? remainingFrom(clock, offsetOf(clock, query.dataUpdatedAt)) : 0;

  return {
    clock,
    remainingMs,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}
