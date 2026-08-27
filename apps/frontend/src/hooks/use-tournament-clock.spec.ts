import { TournamentClockStatus, type TournamentClockDto } from '@poker-system/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { tournamentApi } from '@/lib/api/tournament';
import { useTournamentClock } from './use-tournament-clock';

jest.mock('@/lib/api/tournament', () => ({
  tournamentApi: { getClock: jest.fn() },
}));

const getClock = tournamentApi.getClock as jest.Mock;

/** Relógio do DEVICE parado neste instante; o do servidor está 10s à frente. */
const DEVICE_NOW = Date.parse('2026-01-01T00:00:00.000Z');

/** `serverTime` de um servidor que corre normalmente, `aheadMs` à frente do device. */
function serverTimeNow(aheadMs: number): string {
  return new Date(Date.now() + aheadMs).toISOString();
}

const LEVEL = {
  levelNumber: 3,
  smallBlind: 100,
  bigBlind: 200,
  ante: 25,
  durationSeconds: 900,
  isBreak: false,
  breakLabel: null,
};

function clock(overrides: Partial<TournamentClockDto> = {}): TournamentClockDto {
  return {
    clockStatus: TournamentClockStatus.RUNNING,
    currentLevel: LEVEL,
    nextLevel: null,
    levelEndsAt: '2026-01-01T00:05:10.000Z',
    remainingMs: 300_000,
    serverTime: '2026-01-01T00:00:10.000Z',
    ...overrides,
  };
}

/**
 * Resolve a promise do `useQuery` SEM girar o timer falso (o `waitFor` do RTL
 * gira, e aí o instante do primeiro tique deixa de ser previsível).
 */
async function flush() {
  for (let turn = 0; turn < 3; turn += 1) {
    await act(async () => {
      jest.advanceTimersByTime(0);
    });
  }
}

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('useTournamentClock', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: DEVICE_NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.resetAllMocks();
  });

  it('aplica o offset do servidor em vez de usar o relógio do device', async () => {
    getClock.mockResolvedValue(clock());

    const { result } = renderHook(() => useTournamentClock('trn-1'), { wrapper });
    await flush();

    // levelEndsAt - (deviceNow + 10s de offset) = 310s - 10s = 300s.
    // Sem offset, o device leria 310s — 10 segundos a mais.
    expect(result.current.remainingMs).toBe(300_000);
  });

  it('decresce a cada segundo entre polls', async () => {
    // Servidor 10s à frente e ANDANDO — cada poll traz um `serverTime` novo.
    getClock.mockImplementation(() =>
      Promise.resolve(clock({ serverTime: serverTimeNow(10_000) })),
    );

    const { result } = renderHook(() => useTournamentClock('trn-1'), { wrapper });
    await flush();
    expect(result.current.remainingMs).toBe(300_000);

    await act(async () => {
      jest.advanceTimersByTime(1_000);
    });
    expect(result.current.remainingMs).toBe(299_000);

    await act(async () => {
      jest.advanceTimersByTime(1_000);
    });
    expect(result.current.remainingMs).toBe(298_000);
  });

  it('congela o restante quando PAUSED', async () => {
    getClock.mockResolvedValue(
      clock({ clockStatus: TournamentClockStatus.PAUSED, levelEndsAt: null, remainingMs: 120_000 }),
    );

    const { result } = renderHook(() => useTournamentClock('trn-1'), { wrapper });
    await flush();
    expect(result.current.remainingMs).toBe(120_000);

    await act(async () => {
      jest.advanceTimersByTime(5_000);
    });
    expect(result.current.remainingMs).toBe(120_000);
  });

  it('recalcula o offset a cada poll (corrige deriva do device)', async () => {
    getClock.mockImplementationOnce(() =>
      Promise.resolve(clock({ serverTime: serverTimeNow(10_000) })),
    );
    // Poll seguinte: o device atrasou e o servidor passou a estar 20s à
    // frente. Mesmo `levelEndsAt`, logo o restante encolhe 10s a mais.
    getClock.mockImplementation(() =>
      Promise.resolve(clock({ serverTime: serverTimeNow(20_000) })),
    );

    const { result } = renderHook(() => useTournamentClock('trn-1'), { wrapper });
    await flush();
    expect(result.current.remainingMs).toBe(300_000);

    await act(async () => {
      jest.advanceTimersByTime(2_000);
    });

    // Device andou 2s e o offset saltou de +10s para +20s: o restante cai os
    // 2s do tique MAIS os 10s de deriva que o poll corrigiu.
    expect(result.current.remainingMs).toBe(288_000);
  });

  it('cai no remainingMs do servidor quando levelEndsAt vem nulo em RUNNING', async () => {
    getClock.mockResolvedValue(clock({ levelEndsAt: null, remainingMs: 42_000 }));

    const { result } = renderHook(() => useTournamentClock('trn-1'), { wrapper });
    await flush();

    expect(result.current.remainingMs).toBe(42_000);
  });
});
