import { ClubeRole } from '@poker-system/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { useSession } from '@/components/providers/session-provider';
import { entriesApi } from '@/lib/api/entries';
import { EntryHistoryList } from './entry-history-list';

jest.mock('@/lib/api/entries', () => ({
  entriesApi: { listEntries: jest.fn() },
}));

jest.mock('@/components/providers/session-provider', () => ({
  useSession: jest.fn(),
}));

const mockedUseSession = jest.mocked(useSession);

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function asPlayer() {
  mockedUseSession.mockReturnValue({
    clubeRole: ClubeRole.PLAYER,
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

const TOURNAMENT_ITEM = {
  kind: 'TOURNAMENT' as const,
  id: 'entry-1',
  occurredAt: '2026-02-01T20:00:00.000Z',
  userId: 'other',
  userName: 'Outro Jogador',
  label: 'Sunday Major',
  buyIn: '90.00',
  tournamentStatus: 'PAID' as const,
  finalPosition: 1,
  prizeAmount: '250.00',
  chipStack: 30_000,
  totalBuyIn: null,
  totalCashOut: null,
  currentStack: null,
  tableStatus: null,
  netResult: null,
};

const TABLE_ITEM = {
  kind: 'TABLE' as const,
  id: 'session-1',
  occurredAt: '2026-01-15T18:00:00.000Z',
  userId: 'other',
  userName: 'Outro Jogador',
  label: 'Mesa 1',
  buyIn: null,
  tournamentStatus: null,
  finalPosition: null,
  prizeAmount: null,
  chipStack: null,
  totalBuyIn: '100.00',
  totalCashOut: '150.00',
  currentStack: '0.00',
  tableStatus: 'CASHED_OUT' as const,
  netResult: '50.00',
};

describe('EntryHistoryList', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  it('mostra estado vazio quando não há entradas', async () => {
    asPlayer();
    (entriesApi.listEntries as jest.Mock).mockResolvedValue({ items: [], nextCursor: null });

    renderWithClient(<EntryHistoryList />);

    await waitFor(() => expect(screen.getByText('Nenhuma entrada ainda')).toBeInTheDocument());
  });

  it('lista torneio e mesa, com o valor de cada um', async () => {
    asPlayer();
    (entriesApi.listEntries as jest.Mock).mockResolvedValue({
      items: [TOURNAMENT_ITEM, TABLE_ITEM],
      nextCursor: null,
    });

    renderWithClient(<EntryHistoryList />);

    await waitFor(() => expect(screen.getByText('Sunday Major')).toBeInTheDocument());
    expect(screen.getByText('R$ 250,00')).toBeInTheDocument(); // prêmio
    expect(screen.getByText('Mesa 1')).toBeInTheDocument();
    expect(screen.getByText('R$ 50,00')).toBeInTheDocument(); // resultado líquido
  });

  it('não mostra o nome do jogador quando não é admin', async () => {
    asPlayer();
    (entriesApi.listEntries as jest.Mock).mockResolvedValue({
      items: [TOURNAMENT_ITEM],
      nextCursor: null,
    });

    renderWithClient(<EntryHistoryList />);

    await waitFor(() => expect(screen.getByText('Sunday Major')).toBeInTheDocument());
    expect(screen.queryByText(/Outro Jogador/)).not.toBeInTheDocument();
  });

  it('ADMIN vê o nome de quem fez a entrada', async () => {
    mockedUseSession.mockReturnValue({
      clubeRole: ClubeRole.ADMIN,
      user: { id: 'admin', email: 'admin@x.dev', name: 'Admin' },
      status: 'authenticated',
      login: jest.fn(),
      logout: jest.fn(),
      clubes: [],
      currentClubeId: null,
      switchClube: jest.fn(),
      refreshClubes: jest.fn(),
    });
    (entriesApi.listEntries as jest.Mock).mockResolvedValue({
      items: [TOURNAMENT_ITEM],
      nextCursor: null,
    });

    renderWithClient(<EntryHistoryList />);

    await waitFor(() => expect(screen.getByText(/Outro Jogador/)).toBeInTheDocument());
  });

  it('clicar numa linha abre o modal com os detalhes', async () => {
    asPlayer();
    (entriesApi.listEntries as jest.Mock).mockResolvedValue({
      items: [TOURNAMENT_ITEM],
      nextCursor: null,
    });

    renderWithClient(<EntryHistoryList />);
    await waitFor(() => expect(screen.getByText('Sunday Major')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Sunday Major'));

    expect(screen.getByText('Colocação')).toBeInTheDocument();
    expect(screen.getByText('1º lugar')).toBeInTheDocument();
  });

  it('busca a próxima página ao clicar em "Carregar mais"', async () => {
    asPlayer();
    (entriesApi.listEntries as jest.Mock)
      .mockResolvedValueOnce({ items: [TOURNAMENT_ITEM], nextCursor: 'cursor-1' })
      .mockResolvedValueOnce({ items: [TABLE_ITEM], nextCursor: null });

    renderWithClient(<EntryHistoryList />);

    await waitFor(() => expect(screen.getByText('Carregar mais')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Carregar mais'));

    await waitFor(() => expect(entriesApi.listEntries).toHaveBeenCalledWith('cursor-1'));
    await waitFor(() => expect(screen.queryByText('Carregar mais')).not.toBeInTheDocument());
  });

  it('mostra mensagem de erro quando a query falha', async () => {
    asPlayer();
    (entriesApi.listEntries as jest.Mock).mockRejectedValue(new Error('falhou'));

    renderWithClient(<EntryHistoryList />);

    await waitFor(() =>
      expect(screen.getByText('Não foi possível carregar o histórico.')).toBeInTheDocument(),
    );
  });
});
