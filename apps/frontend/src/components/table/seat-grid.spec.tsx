import { ClubeMembershipStatus, ClubeRole } from '@poker-system/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { useSession } from '@/components/providers/session-provider';
import { clubMembersApi } from '@/lib/api/club';
import { tableApi } from '@/lib/api/table';
import { SeatGrid } from './seat-grid';

jest.mock('@/lib/api/table', () => ({
  tableApi: {
    getTable: jest.fn(),
    getSeats: jest.fn(),
    sitAtTable: jest.fn(),
    sitAtTableForUser: jest.fn(),
    sitGuestAtTable: jest.fn(),
    cashOut: jest.fn(),
    cashOutAsAdmin: jest.fn(),
    rebuy: jest.fn(),
    recordMovement: jest.fn(),
    closeTable: jest.fn(),
  },
}));

jest.mock('@/lib/api/club', () => ({
  clubMembersApi: { listMembers: jest.fn() },
}));

jest.mock('@/components/providers/session-provider', () => ({
  useSession: jest.fn(),
}));

// Referência estável (não um `jest.fn()` novo por render) — precisa disso pra
// asserir depois se/quando a navegação pro lobby foi disparada (ver testes
// do relatório de fechamento, que verificam que NÃO navega antes do modal
// fechar).
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockedUseSession = jest.mocked(useSession);

const ADMIN_SESSION = {
  clubeRole: ClubeRole.ADMIN,
  user: { id: 'admin', email: 'admin@x.dev', name: 'Admin' },
  status: 'authenticated' as const,
  login: jest.fn(),
  logout: jest.fn(),
  clubes: [],
  currentClubeId: null,
  switchClube: jest.fn(),
  refreshClubes: jest.fn(),
};

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
  beforeEach(() => {
    (clubMembersApi.listMembers as jest.Mock).mockResolvedValue([]);
    // Default: mesa OPEN. Sobrescrito no teste de mesa fechada.
    (tableApi.getTable as jest.Mock).mockResolvedValue({ status: 'OPEN' });
  });

  afterEach(() => {
    jest.resetAllMocks(); // já cobre `mockPush`, que também é um `jest.fn()`
  });

  it('senta em um assento vago (buy-in)', async () => {
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

  it('ADMIN registra um novo buy-in (rebuy) num jogador que perdeu as fichas', async () => {
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
    (tableApi.getSeats as jest.Mock).mockResolvedValue([OTHER]);
    (tableApi.rebuy as jest.Mock).mockResolvedValue({ ...OTHER, currentStack: '50.00' });

    renderWithClient(<SeatGrid tableId="table-1" />);
    await waitFor(() => expect(screen.getByText('Outro')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Outro'));
    await waitFor(() => expect(screen.getByText('Novo buy-in')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('Valor do buy-in'), {
      target: { value: '50.00' },
    });
    fireEvent.click(screen.getByText('Registrar buy-in'));

    await waitFor(() =>
      expect(tableApi.rebuy).toHaveBeenCalledWith(
        'table-1',
        'session-other',
        { buyInAmount: '50.00' },
        expect.any(String) as unknown,
      ),
    );
  });

  it('mostra erro da API quando o buy-in falha', async () => {
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
    (tableApi.getSeats as jest.Mock).mockResolvedValue([VACANT]);
    // Mesa vazia (sem `players`) — sem relatório pra mostrar, navega direto.
    (tableApi.closeTable as jest.Mock).mockResolvedValue({ table: {}, players: [] });

    renderWithClient(<SeatGrid tableId="table-1" />);
    await waitFor(() => expect(screen.getByText('Fechar mesa')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Fechar mesa'));
    await waitFor(() => expect(screen.getByText('Sim, fechar mesa')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Sim, fechar mesa'));

    await waitFor(() => expect(tableApi.closeTable).toHaveBeenCalledWith('table-1'));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/lobby'));
  });

  it('mostra o relatório de buy-ins ao fechar a mesa com jogadores, e só navega ao dispensá-lo', async () => {
    mockedUseSession.mockReturnValue(ADMIN_SESSION);
    (tableApi.getSeats as jest.Mock).mockResolvedValue([VACANT]);
    (tableApi.closeTable as jest.Mock).mockResolvedValue({
      table: {},
      players: [
        {
          userId: 'user-1',
          userName: 'Jogador',
          totalBuyIn: '100.00',
          totalCashOut: '150.00',
          currentStack: '0.00',
          netResult: '50.00',
        },
      ],
    });

    renderWithClient(<SeatGrid tableId="table-1" />);
    await waitFor(() => expect(screen.getByText('Fechar mesa')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Fechar mesa'));
    await waitFor(() => expect(screen.getByText('Sim, fechar mesa')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Sim, fechar mesa'));

    await waitFor(() => expect(screen.getByText('Mesa fechada')).toBeInTheDocument());
    expect(screen.getByText('Jogador')).toBeInTheDocument();
    expect(screen.getByText('R$ 50,00')).toBeInTheDocument();
    // Não navega enquanto o admin ainda está vendo o relatório.
    expect(mockPush).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/lobby'));
  });

  it('não mostra "Fechar mesa" numa mesa já fechada, mesmo pro ADMIN', async () => {
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
    (tableApi.getSeats as jest.Mock).mockResolvedValue([VACANT]);
    (tableApi.getTable as jest.Mock).mockResolvedValue({ status: 'CLOSED' });

    renderWithClient(<SeatGrid tableId="table-1" />);
    await waitFor(() => expect(screen.getByText('Sentar')).toBeInTheDocument());

    expect(screen.queryByText('Fechar mesa')).not.toBeInTheDocument();
  });

  it('não mostra "Fechar mesa" pro jogador', async () => {
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
    (tableApi.getSeats as jest.Mock).mockResolvedValue([VACANT]);

    renderWithClient(<SeatGrid tableId="table-1" />);
    await waitFor(() => expect(screen.getByText('Sentar')).toBeInTheDocument());

    expect(screen.queryByText('Fechar mesa')).not.toBeInTheDocument();
  });

  it('seletor de modo (Eu/Membro do clube/Sem cadastro) só aparece pro ADMIN', async () => {
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
    (tableApi.getSeats as jest.Mock).mockResolvedValue([VACANT]);

    renderWithClient(<SeatGrid tableId="table-1" />);
    await waitFor(() => expect(screen.getByText('Sentar')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Sentar'));

    await waitFor(() => expect(screen.getByPlaceholderText('Valor do buy-in')).toBeInTheDocument());
    expect(screen.queryByText('Membro do clube')).not.toBeInTheDocument();
    expect(screen.queryByText('Sem cadastro')).not.toBeInTheDocument();
  });

  it('ADMIN senta um jogador sem cadastro — telefone só aceita dígitos', async () => {
    mockedUseSession.mockReturnValue(ADMIN_SESSION);
    (tableApi.getSeats as jest.Mock).mockResolvedValue([VACANT]);
    (tableApi.sitGuestAtTable as jest.Mock).mockResolvedValue({
      ...VACANT,
      userId: 'guest-1',
      userName: 'Fulano',
    });

    renderWithClient(<SeatGrid tableId="table-1" />);
    await waitFor(() => expect(screen.getByText('Sentar')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Sentar'));
    await waitFor(() => expect(screen.getByText('Sem cadastro')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Sem cadastro'));

    fireEvent.change(screen.getByPlaceholderText('Nome do jogador'), {
      target: { value: 'Fulano' },
    });
    fireEvent.change(screen.getByPlaceholderText('Telefone (DDD + número)'), {
      target: { value: '(11) 98888-7777' },
    });
    fireEvent.change(screen.getByPlaceholderText('Valor do buy-in'), {
      target: { value: '80.00' },
    });
    fireEvent.click(screen.getByText('Confirmar'));

    await waitFor(() =>
      expect(tableApi.sitGuestAtTable).toHaveBeenCalledWith(
        'table-1',
        { seatNumber: 1, buyInAmount: '80.00', name: 'Fulano', phone: '11988887777' },
        expect.any(String) as unknown,
      ),
    );
  });

  it('ADMIN senta um membro do clube já cadastrado — busca exclui quem já está sentado nesta mesa', async () => {
    mockedUseSession.mockReturnValue(ADMIN_SESSION);
    (tableApi.getSeats as jest.Mock).mockResolvedValue([VACANT, MINE]);
    (clubMembersApi.listMembers as jest.Mock).mockResolvedValue([
      {
        id: 'm1',
        userId: 'me',
        name: 'Eu',
        email: 'me@x.dev',
        document: null,
        phone: null,
        isGuest: false,
        role: 'PLAYER',
        status: ClubeMembershipStatus.ACTIVE,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'm2',
        userId: 'novo',
        name: 'Jogador Novo',
        email: 'novo@x.dev',
        document: null,
        phone: null,
        isGuest: false,
        role: 'PLAYER',
        status: ClubeMembershipStatus.ACTIVE,
        createdAt: new Date().toISOString(),
      },
    ]);
    (tableApi.sitAtTableForUser as jest.Mock).mockResolvedValue({
      ...VACANT,
      userId: 'novo',
      userName: 'Jogador Novo',
    });

    renderWithClient(<SeatGrid tableId="table-1" />);
    await waitFor(() => expect(screen.getByText('Sentar')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Sentar'));
    await waitFor(() => expect(screen.getByText('Membro do clube')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Membro do clube'));

    fireEvent.change(screen.getByPlaceholderText('Valor do buy-in'), {
      target: { value: '100.00' },
    });
    // Termo bate com o e-mail dos dois membros — só o filtro de "já sentado
    // nesta mesa" decide quem sobra na lista.
    fireEvent.change(screen.getByPlaceholderText('Nome, e-mail ou CPF'), {
      target: { value: '@x.dev' },
    });

    // "Eu" já está sentado no assento 2 desta mesa (`MINE`) — não aparece na
    // lista de candidatos (a busca é escopada à `<ul>`: "Eu" ainda existe no
    // documento como label do botão de modo "Eu" e do chip do assento 2).
    const candidateList = await screen.findByRole('list');
    await waitFor(() =>
      expect(within(candidateList).getByText('Jogador Novo')).toBeInTheDocument(),
    );
    expect(within(candidateList).queryByText('Eu')).not.toBeInTheDocument();

    fireEvent.click(within(candidateList).getByText('Sentar', { selector: 'button' }));

    await waitFor(() =>
      expect(tableApi.sitAtTableForUser).toHaveBeenCalledWith(
        'table-1',
        'novo',
        { seatNumber: 1, buyInAmount: '100.00' },
        expect.any(String) as unknown,
      ),
    );
  });
});
