'use client';

import {
  TournamentClockStatus,
  type BlindLevelDto,
  type TournamentClockDto,
} from '@poker-system/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { tournamentClockKey, useTournamentClock } from '@/hooks/use-tournament-clock';
import { tournamentApi } from '@/lib/api/tournament';
import type { UpdateBlindLevelRequest } from '@/lib/api/types';
import { Badge, Button, Card, ErrorState, Input, Skeleton, Toast } from '@/components/ui';
import { formatCountdown } from '@/lib/format';
import { ApiError } from '@/lib/http-client';

const ACTIONS = {
  start: tournamentApi.startClock,
  pause: tournamentApi.pauseClock,
  resume: tournamentApi.resumeClock,
  next: tournamentApi.nextLevel,
  previous: tournamentApi.previousLevel,
} as const;

type ClockActionKey = keyof typeof ACTIONS;

/**
 * Espelha as transições que `tournament-clock.service.ts` aceita. Botão fora
 * dessa tabela fica DESABILITADO em vez de mandar um POST que o backend
 * recusaria com 400 — o operador não descobre o estado do relógio por erro.
 */
const ALLOWED_FROM: Record<ClockActionKey, TournamentClockStatus[]> = {
  start: [TournamentClockStatus.NOT_STARTED],
  pause: [TournamentClockStatus.RUNNING],
  resume: [TournamentClockStatus.PAUSED],
  next: [TournamentClockStatus.RUNNING, TournamentClockStatus.PAUSED],
  previous: [TournamentClockStatus.RUNNING, TournamentClockStatus.PAUSED],
};

const ACTION_LABEL: Record<ClockActionKey, string> = {
  start: 'Iniciar',
  pause: 'Pausar',
  resume: 'Retomar',
  next: 'Próximo nível',
  previous: 'Nível anterior',
};

const STATUS_LABEL: Record<TournamentClockStatus, string> = {
  [TournamentClockStatus.NOT_STARTED]: 'Não iniciado',
  [TournamentClockStatus.RUNNING]: 'Em andamento',
  [TournamentClockStatus.PAUSED]: 'Pausado',
  [TournamentClockStatus.FINISHED]: 'Encerrado',
};

const ORDER: ClockActionKey[] = ['start', 'pause', 'resume', 'previous', 'next'];

export function ClockControl({ tournamentId }: { tournamentId: string }) {
  const { clock, remainingMs, isLoading, isError } = useTournamentClock(tournamentId);
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  /**
   * O POST já devolve o relógio atualizado: grava direto no cache (a tela
   * responde sem esperar o próximo poll de 2s) e invalida em seguida, para
   * que o servidor continue sendo a última palavra.
   */
  function applyClock(updated: TournamentClockDto) {
    setError(null);
    queryClient.setQueryData(tournamentClockKey(tournamentId), updated);
    void queryClient.invalidateQueries({ queryKey: tournamentClockKey(tournamentId) });
  }

  function reportError(caught: unknown, fallback: string) {
    setError(caught instanceof ApiError ? caught.message : fallback);
  }

  const actionMutation = useMutation({
    mutationFn: (action: ClockActionKey) => ACTIONS[action](tournamentId),
    onSuccess: applyClock,
    onError: (caught: unknown) => reportError(caught, 'Não foi possível alterar o relógio.'),
  });

  const levelMutation = useMutation({
    mutationFn: ({ levelNumber, ...input }: UpdateBlindLevelRequest & { levelNumber: number }) =>
      tournamentApi.updateBlindLevel(tournamentId, levelNumber, input),
    onSuccess: applyClock,
    onError: (caught: unknown) => reportError(caught, 'Não foi possível salvar o nível.'),
  });

  if (isLoading) {
    return <Skeleton className="h-64 w-full rounded-lg" />;
  }
  if (isError || !clock) {
    return <ErrorState description="Não foi possível carregar o relógio." />;
  }

  const level = clock.currentLevel;

  function isDisabled(action: ClockActionKey): boolean {
    if (!clock) return true;
    if (!ALLOWED_FROM[action].includes(clock.clockStatus)) return true;
    // O backend recusa `previous` no primeiro nível; não oferecemos o botão.
    return action === 'previous' && (clock.currentLevel?.levelNumber ?? 1) <= 1;
  }

  function handleLevelSubmit(event: FormEvent<HTMLFormElement>, levelNumber: number) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    levelMutation.mutate({
      levelNumber,
      smallBlind: Number(data.get('smallBlind')),
      bigBlind: Number(data.get('bigBlind')),
      ante: Number(data.get('ante')),
      durationSeconds: Number(data.get('durationSeconds')),
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <Toast type="error" message={error} />}

      <Card>
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-display text-xl font-semibold">
              {level ? levelTitle(level) : 'Relógio não iniciado'}
            </p>
            <p className="font-ledger text-sm text-muted">{blindsLine(level)}</p>
          </div>
          <Badge
            variant={clock.clockStatus === TournamentClockStatus.RUNNING ? 'success' : 'neutral'}
          >
            {STATUS_LABEL[clock.clockStatus]}
          </Badge>
        </div>

        <p className="font-ledger mt-4 text-6xl font-semibold tabular-nums">
          {formatCountdown(remainingMs)}
        </p>

        <p className="mt-2 text-sm text-muted">
          Próximo:{' '}
          {clock.nextLevel
            ? `${levelTitle(clock.nextLevel)} · ${blindsLine(clock.nextLevel)}`
            : '—'}
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          {ORDER.map((action) => (
            <Button
              key={action}
              size="sm"
              variant={action === 'start' || action === 'resume' ? 'primary' : 'secondary'}
              disabled={isDisabled(action)}
              loading={actionMutation.isPending && actionMutation.variables === action}
              onClick={() => actionMutation.mutate(action)}
            >
              {ACTION_LABEL[action]}
            </Button>
          ))}
        </div>
      </Card>

      {level && (
        <Card title="Editar nível corrente">
          {/*
            Form NÃO-CONTROLADO com `key` no número do nível: o poll de 2s
            reescreve `clock` o tempo todo, e campos controlados por ele
            apagariam o que o operador está digitando. Trocar de nível remonta
            o form com os valores novos.
          */}
          <form
            key={level.levelNumber}
            className="flex flex-col gap-3"
            onSubmit={(event) => handleLevelSubmit(event, level.levelNumber)}
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Input
                label="Small blind"
                name="smallBlind"
                type="number"
                min={1}
                required
                defaultValue={level.smallBlind}
              />
              <Input
                label="Big blind"
                name="bigBlind"
                type="number"
                min={1}
                required
                defaultValue={level.bigBlind}
              />
              <Input
                label="Ante"
                name="ante"
                type="number"
                min={0}
                required
                defaultValue={level.ante}
              />
              {/* Em SEGUNDOS, como o backend: converter para minutos aqui
                  arredondaria um nível de 90s na ida e na volta. */}
              <Input
                label="Duração (s)"
                name="durationSeconds"
                type="number"
                min={1}
                required
                defaultValue={level.durationSeconds}
              />
            </div>
            <Button type="submit" size="sm" loading={levelMutation.isPending}>
              Salvar nível
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}

function levelTitle(level: BlindLevelDto): string {
  return level.isBreak ? (level.breakLabel ?? 'Intervalo') : `Nível ${level.levelNumber}`;
}

function blindsLine(level: BlindLevelDto | null): string {
  if (!level) return 'Sem nível corrente';
  if (level.isBreak) return 'Blinds pausados durante o intervalo';
  return `${level.smallBlind}/${level.bigBlind}${level.ante > 0 ? ` · ante ${level.ante}` : ''}`;
}
