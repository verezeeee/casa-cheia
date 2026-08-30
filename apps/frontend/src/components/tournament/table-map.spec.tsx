import { ClubeRole } from '@poker-system/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { useSession } from '@/components/providers/session-provider';
import { tournamentApi } from '@/lib/api/tournament';
import { TableMap } from './table-map';

jest.mock('@/lib/api/tournament', () => ({
  tournamentApi: {
    getTableMap: jest.fn(),
    redraw: jest.fn(),
    eliminateEntry: jest.fn(),
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

function session(clubeRole: ClubeRole) {
  mockedUseSession.mockReturnValue({
    user: { id: 'u1', email: 'u1@x.dev', name: 'U1' },
    clubeRole,
    status: 'authenticated',
    login: jest.fn(),
    logout: jest.fn(),
  });
}

const MAP = {
  tournamentId: 'trn-1',
  playersRemaining: 3,
  averageStack: 10_000,
  tables: [
    {
      id: 'tbl-1',
      tableNumber: 1,
      capacity: 9,
      status: 'OPEN' as const,
      seats: [
        { entryId: 'entry-a', userName: 'Ana', seatNumber: 1, chipStack: 12_000 },
        { entryId: 'entry-b', userName: 'Bruno', seatNumber: 4, chipStack: 8_000 },
      ],
    },
    {
      id: 'tbl-2',
      tableNumber: 2,
      capacity: 9,
      status: 'OPEN' as const,
      seats: [{ entryId: 'entry-c', userName: 'Carla', seatNumber: 2, chipStack: 10_000 }],
    },
  ],
};

describe('TableMap', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  it('mostra as mesas com ocupação e assentos', async () => {
    session(ClubeRole.PLAYER);
    (tournamentApi.getTableMap as jest.Mock).mockResolvedValue(MAP);

    renderWithClient(<TableMap tournamentId="trn-1" />);

    await waitFor(() => expect(screen.getByText('Mesa 1')).toBeInTheDocument());
    expect(screen.getByText('2/9')).toBeInTheDocument();
    expect(screen.getByText('1/9')).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('Carla')).toBeInTheDocument();
  });

  it('não mostra ações para PLAYER', async () => {
    session(ClubeRole.PLAYER);
    (tournamentApi.getTableMap as jest.Mock).mockResolvedValue(MAP);

    renderWithClient(<TableMap tournamentId="trn-1" />);

    await waitFor(() => expect(screen.getByText('Ana')).toBeInTheDocument());
    expect(screen.queryByText('Redraw manual')).not.toBeInTheDocument();
    expect(screen.queryByText('Eliminar')).not.toBeInTheDocument();
  });

  it('ADMIN elimina um jogador pelo assento', async () => {
    session(ClubeRole.ADMIN);
    (tournamentApi.getTableMap as jest.Mock).mockResolvedValue(MAP);
    (tournamentApi.eliminateEntry as jest.Mock).mockResolvedValue({});

    renderWithClient(<TableMap tournamentId="trn-1" />);
    await waitFor(() => expect(screen.getByText('Ana')).toBeInTheDocument());

    fireEvent.click(screen.getAllByText('Eliminar')[0]);
    fireEvent.click(await screen.findByText('Sim, eliminar'));

    await waitFor(() =>
      expect(tournamentApi.eliminateEntry).toHaveBeenCalledWith('trn-1', 'entry-a', {}),
    );
  });

  it('ADMIN faz redraw após confirmar', async () => {
    session(ClubeRole.ADMIN);
    (tournamentApi.getTableMap as jest.Mock).mockResolvedValue(MAP);
    (tournamentApi.redraw as jest.Mock).mockResolvedValue(MAP);

    renderWithClient(<TableMap tournamentId="trn-1" />);
    await waitFor(() => expect(screen.getByText('Redraw manual')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Redraw manual'));
    fireEvent.click(await screen.findByText('Sim, fazer redraw'));

    await waitFor(() => expect(tournamentApi.redraw).toHaveBeenCalledWith('trn-1'));
  });

  it('mostra erro quando a query falha', async () => {
    session(ClubeRole.ADMIN);
    (tournamentApi.getTableMap as jest.Mock).mockRejectedValue(new Error('falhou'));

    renderWithClient(<TableMap tournamentId="trn-1" />);
    await waitFor(() =>
      expect(screen.getByText('Não foi possível carregar as mesas.')).toBeInTheDocument(),
    );
  });
});
