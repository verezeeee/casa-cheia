import { TournamentClockStatus, type TournamentClockDto } from '@poker-system/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { tournamentApi } from '@/lib/api/tournament';
import { BlindDisplay } from './blind-display';

jest.mock('@/lib/api/tournament', () => ({
  tournamentApi: { getClock: jest.fn(), getTableMap: jest.fn() },
}));

const NOW = Date.parse('2026-01-01T00:00:00.000Z');

const LEVEL = {
  levelNumber: 5,
  smallBlind: 300,
  bigBlind: 600,
  ante: 75,
  durationSeconds: 900,
  isBreak: false,
  breakLabel: null,
};

const BREAK_LEVEL = {
  ...LEVEL,
  levelNumber: 6,
  isBreak: true,
  breakLabel: 'Intervalo · 15 min',
};

function clock(overrides: Partial<TournamentClockDto> = {}): TournamentClockDto {
  return {
    clockStatus: TournamentClockStatus.RUNNING,
    currentLevel: LEVEL,
    nextLevel: BREAK_LEVEL,
    levelEndsAt: '2026-01-01T00:10:00.000Z',
    remainingMs: 600_000,
    serverTime: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const TABLE_MAP = {
  tournamentId: 'trn-1',
  tables: [],
  playersRemaining: 27,
  averageStack: 42_000,
};

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('BlindDisplay', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
    (tournamentApi.getTableMap as jest.Mock).mockResolvedValue(TABLE_MAP);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.resetAllMocks();
  });

  it('mostra nível, blinds, tempo e o painel de jogadores em RUNNING', async () => {
    (tournamentApi.getClock as jest.Mock).mockResolvedValue(clock());

    renderWithClient(<BlindDisplay tournamentId="trn-1" />);

    expect(await screen.findByText('Nível 5')).toBeInTheDocument();
    expect(screen.getByText(/300 \/ 600/)).toBeInTheDocument();
    expect(screen.getByText(/ante 75/)).toBeInTheDocument();
    expect(screen.getByText('10:00')).toBeInTheDocument();
    expect(await screen.findByText('27')).toBeInTheDocument();
    expect(screen.getByText('42.000')).toBeInTheDocument();
    expect(screen.queryByText('Pausado')).not.toBeInTheDocument();
  });

  it('anuncia a troca de nível por aria-live, sem colocá-lo no contador', async () => {
    (tournamentApi.getClock as jest.Mock).mockResolvedValue(clock());

    renderWithClient(<BlindDisplay tournamentId="trn-1" />);
    const level = await screen.findByText('Nível 5');

    expect(level.closest('[aria-live="polite"]')).not.toBeNull();
    expect(screen.getByText('10:00').closest('[aria-live]')).toBeNull();
  });

  it('mostra o restante congelado e o aviso em PAUSED', async () => {
    (tournamentApi.getClock as jest.Mock).mockResolvedValue(
      clock({
        clockStatus: TournamentClockStatus.PAUSED,
        levelEndsAt: null,
        remainingMs: 125_000,
      }),
    );

    renderWithClient(<BlindDisplay tournamentId="trn-1" />);

    expect(await screen.findByText('Pausado')).toBeInTheDocument();
    expect(screen.getByText('02:05')).toBeInTheDocument();
  });

  it('destaca o breakLabel e esconde os blinds durante o intervalo', async () => {
    (tournamentApi.getClock as jest.Mock).mockResolvedValue(
      clock({ currentLevel: BREAK_LEVEL, nextLevel: { ...LEVEL, levelNumber: 7 } }),
    );

    renderWithClient(<BlindDisplay tournamentId="trn-1" />);

    expect(await screen.findByText('Intervalo · 15 min')).toBeInTheDocument();
    expect(screen.queryByText(/300 \/ 600/)).not.toBeInTheDocument();
  });

  it('não tem nenhum controle interativo na árvore (tela somente leitura)', async () => {
    (tournamentApi.getClock as jest.Mock).mockResolvedValue(clock());

    renderWithClient(<BlindDisplay tournamentId="trn-1" />);
    await screen.findByText('Nível 5');

    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(document.querySelectorAll('input, select, textarea, [tabindex]')).toHaveLength(0);
  });
});
