import { UserRole } from '@poker-system/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { useSession } from '@/components/providers/session-provider';
import { tableApi } from '@/lib/api/table';
import { SeatGrid } from './seat-grid';

jest.mock('@/lib/api/table', () => ({
  tableApi: {
    getSeats: jest.fn(),
    sitAtTable: jest.fn(),
    cashOut: jest.fn(),
    recordMovement: jest.fn(),
    closeTable: jest.fn(),
  },
}));

jest.mock('@/components/providers/session-provider', () => ({
  useSession: jest.fn(),
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

const mockedUseSession = jest.mocked(useSession);

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

const VACANT = { seatNumber: 1, userId: null, userName: null, currentStack: null, sessionId: null };
const MINE = {
  seatNumber: 2,
  userId: 'me',
  userName: 'Eu',
  currentStack: '100.00',
  sessionId: 'session-mine',
};
const OTHER = {
  seatNumber: 3,
  userId: 'other',
  userName: 'Outro',
  currentStack: '50.00',
  sessionId: 'session-other',
};

describe('SeatGrid', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  it('senta em um assento vago (buy-in)', async () => {
    mockedUseSession.mockReturnValue({
      user: { id: 'me', email: 'me@x.dev', name: 'Eu', role: UserRole.PLAYER },
      status: 'authenticated',
      login: jest.fn(),
      logout: jest.fn(),
    });
    (tableApi.getSeats as jest.Mock).mockResolvedValue([VACANT]);
    (tableApi.sitAtTable as jest.Mock).mockResolvedValue({ ...VACANT, userId: 'me' });

    renderWithClient(<SeatGrid tableId="table-1" />);
    await waitFor(() => expect(screen.getByText('Sentar')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Sentar'));
    fireEvent.change(screen.getByPlaceholderText('Valor do buy-in'), {
      target: { value: '50.00' },
    });
    fireEvent.click(screen.getByText('Confirmar'));

    await waitFor(() =>
      expect(tableApi.sitAtTable).toHaveBeenCalledWith(
        'table-1',
        { seatNumber: 1, buyInAmount: '50.00' },
        expect.any(String) as unknown,
      ),
    );
  });

  it('mostra Cash-out apenas no próprio assento', async () => {
    mockedUseSession.mockReturnValue({
      user: { id: 'me', email: 'me@x.dev', name: 'Eu', role: UserRole.PLAYER },
      status: 'authenticated',
      login: jest.fn(),
      logout: jest.fn(),
    });
    (tableApi.getSeats as jest.Mock).mockResolvedValue([MINE, OTHER]);
    (tableApi.cashOut as jest.Mock).mockResolvedValue({ ...MINE, userId: null, sessionId: null });

    renderWithClient(<SeatGrid tableId="table-1" />);
    await waitFor(() => expect(screen.getByText('Eu')).toBeInTheDocument());
    expect(screen.getByText('Outro')).toBeInTheDocument();

    // abre o diálogo do próprio assento pra ver as ações
    fireEvent.click(screen.getByText('Eu'));
    await waitFor(() => expect(screen.getAllByText('Cash-out')).toHaveLength(1));

    fireEvent.click(screen.getByText('Cash-out'));
    await waitFor(() =>
      expect(tableApi.cashOut).toHaveBeenCalledWith(
        'table-1',
        'session-mine',
        expect.any(String) as unknown,
      ),
    );
  });

  it('ADMIN pode ajustar o stack de outro jogador', async () => {
    mockedUseSession.mockReturnValue({
      user: { id: 'admin', email: 'admin@x.dev', name: 'Admin', role: UserRole.ADMIN },
      status: 'authenticated',
      login: jest.fn(),
      logout: jest.fn(),
    });
    (tableApi.getSeats as jest.Mock).mockResolvedValue([OTHER]);
    (tableApi.recordMovement as jest.Mock).mockResolvedValue({ ...OTHER, currentStack: '75.00' });

    renderWithClient(<SeatGrid tableId="table-1" />);
    await waitFor(() => expect(screen.getByText('Outro')).toBeInTheDocument());

    // abre o diálogo do assento pra ver o formulário de ajuste
    fireEvent.click(screen.getByText('Outro'));
    await waitFor(() =>
      expect(screen.getByText('Ajustar stack (resultado de mão)')).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByPlaceholderText('+25.00 ou -25.00'), {
      target: { value: '25.00' },
    });
    fireEvent.click(screen.getByText('Aplicar'));

    await waitFor(() =>
      expect(tableApi.recordMovement).toHaveBeenCalledWith('table-1', 'session-other', {
        amount: '25.00',
        reason: 'HAND_RESULT',
      }),
    );
  });

  it('mostra erro da API quando o buy-in falha', async () => {
    mockedUseSession.mockReturnValue({
      user: { id: 'me', email: 'me@x.dev', name: 'Eu', role: UserRole.PLAYER },
      status: 'authenticated',
      login: jest.fn(),
      logout: jest.fn(),
    });
    (tableApi.getSeats as jest.Mock).mockResolvedValue([VACANT]);
    (tableApi.sitAtTable as jest.Mock).mockRejectedValue(new Error('saldo insuficiente'));

    renderWithClient(<SeatGrid tableId="table-1" />);
    await waitFor(() => expect(screen.getByText('Sentar')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Sentar'));
    fireEvent.change(screen.getByPlaceholderText('Valor do buy-in'), {
      target: { value: '50.00' },
    });
    fireEvent.click(screen.getByText('Confirmar'));

    await waitFor(() =>
      expect(screen.getByText('Não foi possível sentar na mesa.')).toBeInTheDocument(),
    );
  });

  it('mostra "Fechar mesa" só pro ADMIN e chama a API ao confirmar', async () => {
    mockedUseSession.mockReturnValue({
      user: { id: 'admin', email: 'admin@x.dev', name: 'Admin', role: UserRole.ADMIN },
      status: 'authenticated',
      login: jest.fn(),
      logout: jest.fn(),
    });
    (tableApi.getSeats as jest.Mock).mockResolvedValue([VACANT]);
    (tableApi.closeTable as jest.Mock).mockResolvedValue({});

    renderWithClient(<SeatGrid tableId="table-1" />);
    await waitFor(() => expect(screen.getByText('Fechar mesa')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Fechar mesa'));
    await waitFor(() => expect(screen.getByText('Sim, fechar mesa')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Sim, fechar mesa'));

    await waitFor(() => expect(tableApi.closeTable).toHaveBeenCalledWith('table-1'));
  });

  it('não mostra "Fechar mesa" pro jogador', async () => {
    mockedUseSession.mockReturnValue({
      user: { id: 'me', email: 'me@x.dev', name: 'Eu', role: UserRole.PLAYER },
      status: 'authenticated',
      login: jest.fn(),
      logout: jest.fn(),
    });
    (tableApi.getSeats as jest.Mock).mockResolvedValue([VACANT]);

    renderWithClient(<SeatGrid tableId="table-1" />);
    await waitFor(() => expect(screen.getByText('Sentar')).toBeInTheDocument());

    expect(screen.queryByText('Fechar mesa')).not.toBeInTheDocument();
  });
});
