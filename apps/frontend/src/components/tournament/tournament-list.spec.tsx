import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { tournamentApi } from '@/lib/api/tournament';
import { TournamentList } from './tournament-list';

jest.mock('@/lib/api/tournament', () => ({
  tournamentApi: { listTournaments: jest.fn() },
}));

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

const TOURNAMENT = {
  id: 'trn-1',
  name: 'Sunday Major',
  buyIn: '90.00',
  fee: '10.00',
  maxPlayers: 9,
  registeredPlayers: 3,
  status: 'REGISTERING' as const,
  startsAt: '2026-09-01T20:00:00.000Z',
};

describe('TournamentList', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  it('mostra estado vazio quando não há torneios', async () => {
    (tournamentApi.listTournaments as jest.Mock).mockResolvedValue({
      items: [],
      nextCursor: null,
    });
    renderWithClient(<TournamentList />);
    await waitFor(() => expect(screen.getByText('Nenhum torneio aberto')).toBeInTheDocument());
  });

  it('lista os torneios com link para o detalhe', async () => {
    (tournamentApi.listTournaments as jest.Mock).mockResolvedValue({
      items: [TOURNAMENT],
      nextCursor: null,
    });
    renderWithClient(<TournamentList />);

    await waitFor(() => expect(screen.getByText('Sunday Major')).toBeInTheDocument());
    expect(screen.getByText(/3\/9 inscritos/)).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/tournaments/trn-1');
  });

  it('mostra mensagem de erro quando a query falha', async () => {
    (tournamentApi.listTournaments as jest.Mock).mockRejectedValue(new Error('falhou'));
    renderWithClient(<TournamentList />);
    await waitFor(() =>
      expect(screen.getByText('Não foi possível carregar os torneios.')).toBeInTheDocument(),
    );
  });
});
