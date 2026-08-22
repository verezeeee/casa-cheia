import { UserRole } from '@poker-system/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { useSession } from '@/components/providers/session-provider';
import { tournamentApi } from '@/lib/api/tournament';
import { TournamentDetail } from './tournament-detail';

jest.mock('@/lib/api/tournament', () => ({
  tournamentApi: {
    getTournament: jest.fn(),
    registerEntry: jest.fn(),
    eliminateEntry: jest.fn(),
    finishTournament: jest.fn(),
  },
}));

jest.mock('@/components/providers/session-provider', () => ({
  useSession: jest.fn(),
}));

const mockedUseSession = jest.mocked(useSession);

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

const TOURNAMENT = {
  id: 'trn-1',
  name: 'Sunday Major',
  buyIn: '90.00',
  fee: '10.00',
  maxPlayers: 3,
  registeredPlayers: 1,
  status: 'REGISTERING' as const,
  startsAt: '2026-09-01T20:00:00.000Z',
  prizes: [{ position: 1, percentage: '100.00' }],
  entries: [
    {
      id: 'entry-other',
      userId: 'other',
      userName: 'Outro',
      status: 'REGISTERED' as const,
      chipStack: 10_000,
      finalPosition: null,
      prizeAmount: null,
    },
  ],
};

describe('TournamentDetail', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  it('permite que um jogador não inscrito se inscreva', async () => {
    mockedUseSession.mockReturnValue({
      user: { id: 'me', email: 'me@x.dev', name: 'Eu', role: UserRole.PLAYER },
      status: 'authenticated',
      login: jest.fn(),
      logout: jest.fn(),
    });
    (tournamentApi.getTournament as jest.Mock).mockResolvedValue(TOURNAMENT);
    (tournamentApi.registerEntry as jest.Mock).mockResolvedValue({});

    renderWithClient(<TournamentDetail tournamentId="trn-1" />);
    await waitFor(() => expect(screen.getByText('Inscrever-se')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Inscrever-se'));
    await waitFor(() =>
      expect(tournamentApi.registerEntry).toHaveBeenCalledWith('trn-1', expect.any(String)),
    );
  });

  it('não mostra o botão de inscrição para quem já está inscrito', async () => {
    mockedUseSession.mockReturnValue({
      user: { id: 'other', email: 'other@x.dev', name: 'Outro', role: UserRole.PLAYER },
      status: 'authenticated',
      login: jest.fn(),
      logout: jest.fn(),
    });
    (tournamentApi.getTournament as jest.Mock).mockResolvedValue(TOURNAMENT);

    renderWithClient(<TournamentDetail tournamentId="trn-1" />);
    await waitFor(() =>
      expect(screen.getByText('Você está inscrito neste torneio.')).toBeInTheDocument(),
    );
    expect(screen.queryByText('Inscrever-se')).not.toBeInTheDocument();
  });

  it('ADMIN pode eliminar uma inscrição e encerrar o torneio', async () => {
    mockedUseSession.mockReturnValue({
      user: { id: 'admin', email: 'admin@x.dev', name: 'Admin', role: UserRole.ADMIN },
      status: 'authenticated',
      login: jest.fn(),
      logout: jest.fn(),
    });
    (tournamentApi.getTournament as jest.Mock).mockResolvedValue(TOURNAMENT);
    (tournamentApi.eliminateEntry as jest.Mock).mockResolvedValue({});
    (tournamentApi.finishTournament as jest.Mock).mockResolvedValue({});

    renderWithClient(<TournamentDetail tournamentId="trn-1" />);
    await waitFor(() => expect(screen.getByText('Outro')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Eliminar'));
    fireEvent.change(screen.getByPlaceholderText('Colocação final (opcional)'), {
      target: { value: '1' },
    });
    fireEvent.click(screen.getByText('Confirmar'));
    await waitFor(() =>
      expect(tournamentApi.eliminateEntry).toHaveBeenCalledWith('trn-1', 'entry-other', {
        finalPosition: 1,
      }),
    );

    fireEvent.click(screen.getByText('Encerrar torneio'));
    await waitFor(() => expect(tournamentApi.finishTournament).toHaveBeenCalledWith('trn-1'));
  });

  it('mostra mensagem de erro quando a query falha', async () => {
    mockedUseSession.mockReturnValue({
      user: { id: 'me', email: 'me@x.dev', name: 'Eu', role: UserRole.PLAYER },
      status: 'authenticated',
      login: jest.fn(),
      logout: jest.fn(),
    });
    (tournamentApi.getTournament as jest.Mock).mockRejectedValue(new Error('falhou'));

    renderWithClient(<TournamentDetail tournamentId="trn-1" />);
    await waitFor(() =>
      expect(screen.getByText('Não foi possível carregar o torneio.')).toBeInTheDocument(),
    );
  });
});
