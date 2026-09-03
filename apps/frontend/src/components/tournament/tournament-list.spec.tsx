import { ClubeRole } from '@poker-system/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { useSession } from '@/components/providers/session-provider';
import { tournamentApi } from '@/lib/api/tournament';
import { TournamentList } from './tournament-list';

jest.mock('@/lib/api/tournament', () => ({
  tournamentApi: { listTournaments: jest.fn() },
}));

// A lista passou a depender do papel no clube por causa do atalho de
// relatório, que é só para ADMIN (`RT-FE-05`/`RT-003`).
jest.mock('@/components/providers/session-provider', () => ({
  useSession: jest.fn(),
}));

const mockedUseSession = jest.mocked(useSession);

function mockSession(clubeRole: ClubeRole) {
  mockedUseSession.mockReturnValue({
    clubeRole,
    user: { id: 'me', email: 'me@x.dev', name: 'Eu' },
    status: 'authenticated',
    login: jest.fn(),
    logout: jest.fn(),
    clubes: [],
    currentClubeId: null,
    switchClube: jest.fn(),
    refreshClubes: jest.fn(),
  });
}

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
  beforeEach(() => {
    mockSession(ClubeRole.PLAYER);
  });

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

  it('oferece o relatório ao ADMIN nos torneios já encerrados', async () => {
    mockSession(ClubeRole.ADMIN);
    (tournamentApi.listTournaments as jest.Mock).mockResolvedValue({
      items: [
        { ...TOURNAMENT, id: 'trn-fim', name: 'Encerrado', status: 'FINISHED' as const },
        TOURNAMENT,
      ],
      nextCursor: null,
    });
    renderWithClient(<TournamentList />);

    await waitFor(() => expect(screen.getByText('Encerrado')).toBeInTheDocument());
    expect(screen.getByText('Ver relatório')).toHaveAttribute(
      'href',
      '/tournaments/trn-fim/report',
    );
    // Só no item encerrado: o torneio em inscrição não tem relatório
    // (`RT-002`).
    expect(screen.getAllByText('Ver relatório')).toHaveLength(1);
  });

  it('não oferece o relatório para quem não é ADMIN', async () => {
    mockSession(ClubeRole.PLAYER);
    (tournamentApi.listTournaments as jest.Mock).mockResolvedValue({
      items: [{ ...TOURNAMENT, status: 'FINISHED' as const }],
      nextCursor: null,
    });
    renderWithClient(<TournamentList />);

    await waitFor(() => expect(screen.getByText('Sunday Major')).toBeInTheDocument());
    expect(screen.queryByText('Ver relatório')).not.toBeInTheDocument();
  });

  it('mostra mensagem de erro quando a query falha', async () => {
    (tournamentApi.listTournaments as jest.Mock).mockRejectedValue(new Error('falhou'));
    renderWithClient(<TournamentList />);
    await waitFor(() =>
      expect(screen.getByText('Não foi possível carregar os torneios.')).toBeInTheDocument(),
    );
  });
});
