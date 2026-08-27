'use client';

import { TournamentClockStatus, type BlindLevelDto } from '@poker-system/shared';
import { useQuery } from '@tanstack/react-query';
import { useTournamentClock } from '@/hooks/use-tournament-clock';
import { tournamentApi } from '@/lib/api/tournament';
import { formatCountdown } from '@/lib/format';

/**
 * Painel de blinds da TV do salão (MT-FE-04).
 *
 * SOMENTE LEITURA por contrato: nenhum botão, link ou campo na árvore — a tela
 * fica ligada sem ninguém por perto, e um controle aqui seria um pause
 * acidental no meio do torneio. Roda também SEM sessão: só consome as rotas
 * públicas `/display/tournaments/:id/...`.
 *
 * Cores fixas (preto/branco), não os tokens de tema: contraste de projetor e
 * de TV de salão não pode depender do `prefers-color-scheme` do device.
 */
export function BlindDisplay({ tournamentId }: { tournamentId: string }) {
  const { clock, remainingMs, isLoading, isError } = useTournamentClock(tournamentId);

  // `playersRemaining`/`averageStack` não estão no DTO do relógio — vêm do
  // mapa de mesas, que é público pelo mesmo controller. Poll mais lento: são
  // números que mudam a cada eliminação, não a cada segundo.
  const tableMap = useQuery({
    queryKey: ['tournaments', tournamentId, 'tables', 'display'],
    queryFn: () => tournamentApi.getTableMap(tournamentId),
    refetchInterval: 5000,
  });

  if (isLoading) {
    return <Screen>Carregando…</Screen>;
  }
  if (isError || !clock) {
    return <Screen>Sem conexão com o servidor</Screen>;
  }

  const level = clock.currentLevel;
  const isBreak = level?.isBreak ?? false;
  const paused = clock.clockStatus === TournamentClockStatus.PAUSED;

  return (
    <Screen>
      <div className="flex w-full flex-col items-center gap-6 sm:gap-10">
        {/* `aria-live` SÓ aqui: o leitor de tela anuncia a troca de nível, não
            cada segundo do relógio. */}
        <div aria-live="polite" className="text-center">
          {isBreak ? (
            <p className="font-display text-5xl font-bold text-amber-300 sm:text-7xl">
              {level?.breakLabel ?? 'Intervalo'}
            </p>
          ) : (
            <p className="font-display text-4xl font-semibold tracking-wide text-white/70 uppercase sm:text-6xl">
              {level ? `Nível ${level.levelNumber}` : 'Aguardando início'}
            </p>
          )}
        </div>

        <p className="font-ledger text-[22vw] leading-none font-bold tabular-nums sm:text-[16vw]">
          {formatCountdown(remainingMs)}
        </p>

        {paused && (
          <p className="font-display text-3xl font-semibold tracking-widest text-amber-300 uppercase">
            Pausado
          </p>
        )}

        {level && !isBreak && (
          <p className="font-ledger text-6xl font-semibold tabular-nums sm:text-8xl">
            {level.smallBlind} / {level.bigBlind}
            {level.ante > 0 && <span className="text-white/60"> · ante {level.ante}</span>}
          </p>
        )}

        <dl className="grid w-full max-w-5xl grid-cols-2 gap-6 text-center sm:grid-cols-3">
          <Stat label="Próximo nível" value={nextLevelText(clock.nextLevel)} />
          {tableMap.data && (
            <>
              <Stat label="Jogadores" value={String(tableMap.data.playersRemaining)} />
              <Stat
                label="Stack médio"
                value={tableMap.data.averageStack.toLocaleString('pt-BR')}
              />
            </>
          )}
        </dl>
      </div>
    </Screen>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-[100dvh] w-full flex-col items-center justify-center gap-8 bg-black p-6 text-white">
      {children}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-lg tracking-widest text-white/50 uppercase sm:text-xl">{label}</dt>
      <dd className="font-ledger text-3xl font-semibold tabular-nums sm:text-5xl">{value}</dd>
    </div>
  );
}

function nextLevelText(level: BlindLevelDto | null): string {
  if (!level) return '—';
  if (level.isBreak) return level.breakLabel ?? 'Intervalo';
  return `${level.smallBlind}/${level.bigBlind}${level.ante > 0 ? ` (${level.ante})` : ''}`;
}
