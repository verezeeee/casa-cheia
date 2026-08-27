import { TournamentClockStatus, type TournamentClockDto } from '@poker-system/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { tournamentApi } from '@/lib/api/tournament';
import { ClockControl } from './clock-control';

jest.mock('@/lib/api/tournament', () => ({
  tournamentApi: {
    getClock: jest.fn(),
    startClock: jest.fn(),
    pauseClock: jest.fn(),
    resumeClock: jest.fn(),
    nextLevel: jest.fn(),
    previousLevel: jest.fn(),
    updateBlindLevel: jest.fn(),
  },
}));

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
    nextLevel: { ...LEVEL, levelNumber: 4, smallBlind: 150, bigBlind: 300 },
    levelEndsAt: '2026-01-01T00:10:00.000Z',
    remainingMs: 600_000,
    serverTime: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function button(name: string) {
  return screen.getByRole('button', { name });
}

describe('ClockControl', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  it('em NOT_STARTED só habilita "Iniciar"', async () => {
    (tournamentApi.getClock as jest.Mock).mockResolvedValue(
      clock({
        clockStatus: TournamentClockStatus.NOT_STARTED,
        currentLevel: null,
        levelEndsAt: null,
        remainingMs: 0,
      }),
    );

    renderWithClient(<ClockControl tournamentId="trn-1" />);
    await screen.findByText('Relógio não iniciado');

    expect(button('Iniciar')).toBeEnabled();
    expect(button('Pausar')).toBeDisabled();
    expect(button('Retomar')).toBeDisabled();
    expect(button('Próximo nível')).toBeDisabled();
    expect(button('Nível anterior')).toBeDisabled();
  });

  it('em RUNNING habilita pausar/avançar/voltar e desabilita iniciar/retomar', async () => {
    (tournamentApi.getClock as jest.Mock).mockResolvedValue(clock());

    renderWithClient(<ClockControl tournamentId="trn-1" />);
    await screen.findByText('Nível 3');

    expect(button('Pausar')).toBeEnabled();
    expect(button('Próximo nível')).toBeEnabled();
    expect(button('Nível anterior')).toBeEnabled();
    expect(button('Iniciar')).toBeDisabled();
    expect(button('Retomar')).toBeDisabled();
  });

  it('desabilita "Nível anterior" no primeiro nível (o backend recusaria)', async () => {
    (tournamentApi.getClock as jest.Mock).mockResolvedValue(
      clock({ currentLevel: { ...LEVEL, levelNumber: 1 } }),
    );

    renderWithClient(<ClockControl tournamentId="trn-1" />);
    await screen.findByText('Nível 1');

    expect(button('Nível anterior')).toBeDisabled();
    expect(button('Próximo nível')).toBeEnabled();
  });

  it('em PAUSED troca pausar por retomar', async () => {
    (tournamentApi.getClock as jest.Mock).mockResolvedValue(
      clock({ clockStatus: TournamentClockStatus.PAUSED, levelEndsAt: null }),
    );

    renderWithClient(<ClockControl tournamentId="trn-1" />);
    await screen.findByText('Pausado');

    expect(button('Retomar')).toBeEnabled();
    expect(button('Pausar')).toBeDisabled();
    expect(button('Iniciar')).toBeDisabled();
  });

  it('em FINISHED não habilita nenhuma transição', async () => {
    (tournamentApi.getClock as jest.Mock).mockResolvedValue(
      clock({ clockStatus: TournamentClockStatus.FINISHED, levelEndsAt: null, remainingMs: 0 }),
    );

    renderWithClient(<ClockControl tournamentId="trn-1" />);
    await screen.findByText('Encerrado');

    for (const name of ['Iniciar', 'Pausar', 'Retomar', 'Próximo nível', 'Nível anterior']) {
      expect(button(name)).toBeDisabled();
    }
  });

  it('aplica a resposta do POST na tela (cache + invalidação)', async () => {
    // O `GET` acompanha o efeito do `POST` — como no servidor real. Sem isso,
    // a invalidação que segue o `setQueryData` traria o estado antigo de volta.
    let state = clock();
    (tournamentApi.getClock as jest.Mock).mockImplementation(() => Promise.resolve(state));
    (tournamentApi.pauseClock as jest.Mock).mockImplementation(() => {
      state = clock({
        clockStatus: TournamentClockStatus.PAUSED,
        levelEndsAt: null,
        remainingMs: 120_000,
      });
      return Promise.resolve(state);
    });

    renderWithClient(<ClockControl tournamentId="trn-1" />);
    await screen.findByText('Em andamento');

    fireEvent.click(button('Pausar'));

    await waitFor(() => expect(tournamentApi.pauseClock).toHaveBeenCalledWith('trn-1'));
    await screen.findByText('Pausado');
    expect(await screen.findByText('02:00')).toBeInTheDocument();
  });

  it('edita o nível corrente com os valores do form (duração em segundos)', async () => {
    (tournamentApi.getClock as jest.Mock).mockResolvedValue(clock());
    (tournamentApi.updateBlindLevel as jest.Mock).mockResolvedValue(clock());

    renderWithClient(<ClockControl tournamentId="trn-1" />);
    await screen.findByText('Nível 3');

    fireEvent.change(screen.getByLabelText('Big blind'), { target: { value: '400' } });
    fireEvent.change(screen.getByLabelText('Duração (s)'), { target: { value: '1200' } });
    fireEvent.click(button('Salvar nível'));

    await waitFor(() =>
      expect(tournamentApi.updateBlindLevel).toHaveBeenCalledWith('trn-1', 3, {
        smallBlind: 100,
        bigBlind: 400,
        ante: 25,
        durationSeconds: 1200,
      }),
    );
  });
});
