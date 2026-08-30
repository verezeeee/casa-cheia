import { ClubeRole } from '@poker-system/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { useSession } from '@/components/providers/session-provider';
import { clubMembersApi } from '@/lib/api/club';
import { tournamentApi } from '@/lib/api/tournament';
import { TournamentDetail } from './tournament-detail';

jest.mock('@/lib/api/tournament', () => ({
  tournamentApi: {
    getTournament: jest.fn(),
    registerEntry: jest.fn(),
    unregisterEntry: jest.fn(),
    unregisterEntryForUser: jest.fn(),
    registerEntryForUser: jest.fn(),
    eliminateEntry: jest.fn(),
    finishTournament: jest.fn(),
    updateTournament: jest.fn(),
  },
}));

jest.mock('@/lib/api/club', () => ({
  clubMembersApi: { listMembers: jest.fn() },
}));

// `EditTournamentForm` (montado ao clicar em "Editar") busca o catálogo de
// presets — sem o mock, a suíte tentaria uma requisição real.
jest.mock('@/lib/api/blind-structure', () => ({
  blindStructureApi: { listBlindStructures: jest.fn().mockResolvedValue([]) },
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
      tableNumber: null,
      seatNumber: null,
    },
  ],
};

const TOURNAMENT_SEATED = {
  ...TOURNAMENT,
  entries: [{ ...TOURNAMENT.entries[0], tableNumber: 3, seatNumber: 7 }],
};

describe('TournamentDetail', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  it('permite que um jogador não inscrito se inscreva', async () => {
    mockedUseSession.mockReturnValue({
      clubeRole: ClubeRole.PLAYER,
      user: { id: 'me', email: 'me@x.dev', name: 'Eu' },
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
      expect(tournamentApi.registerEntry).toHaveBeenCalledWith('trn-1', expect.any(String), {
        staffBonus: false,
      }),
    );
  });

  it('mostra o checkbox de bônus de staff quando o torneio oferece, e repassa a opção', async () => {
    mockedUseSession.mockReturnValue({
      clubeRole: ClubeRole.PLAYER,
      user: { id: 'me', email: 'me@x.dev', name: 'Eu' },
      status: 'authenticated',
      login: jest.fn(),
      logout: jest.fn(),
    });
    (tournamentApi.getTournament as jest.Mock).mockResolvedValue({
      ...TOURNAMENT,
      staffBonusCost: '5.00',
      staffBonusChips: 2_500,
    });
    (tournamentApi.registerEntry as jest.Mock).mockResolvedValue({});

    renderWithClient(<TournamentDetail tournamentId="trn-1" />);
    const checkbox = await screen.findByRole('checkbox', { name: /bônus de staff/i });

    fireEvent.click(checkbox);
    fireEvent.click(screen.getByText('Inscrever-se'));
    await waitFor(() =>
      expect(tournamentApi.registerEntry).toHaveBeenCalledWith('trn-1', expect.any(String), {
        staffBonus: true,
      }),
    );
  });

  it('não mostra o botão de inscrição para quem já está inscrito', async () => {
    mockedUseSession.mockReturnValue({
      clubeRole: ClubeRole.PLAYER,
      user: { id: 'other', email: 'other@x.dev', name: 'Outro' },
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

  // Bug relatado: inscrição REFUNDED continuava mostrando "Você está
  // inscrito" e escondendo o botão de se inscrever de novo.
  it('trata inscrição REFUNDED como cancelada — não mostra "inscrito" e libera se inscrever de novo', async () => {
    mockedUseSession.mockReturnValue({
      clubeRole: ClubeRole.PLAYER,
      user: { id: 'other', email: 'other@x.dev', name: 'Outro' },
      status: 'authenticated',
      login: jest.fn(),
      logout: jest.fn(),
    });
    (tournamentApi.getTournament as jest.Mock).mockResolvedValue({
      ...TOURNAMENT,
      entries: [{ ...TOURNAMENT.entries[0], status: 'REFUNDED' as const }],
    });

    renderWithClient(<TournamentDetail tournamentId="trn-1" />);
    await waitFor(() => expect(screen.getByText('Inscrever-se')).toBeInTheDocument());

    expect(screen.queryByText('Você está inscrito neste torneio.')).not.toBeInTheDocument();
  });

  it('permite cancelar a própria inscrição antes do torneio começar', async () => {
    mockedUseSession.mockReturnValue({
      clubeRole: ClubeRole.PLAYER,
      user: { id: 'other', email: 'other@x.dev', name: 'Outro' },
      status: 'authenticated',
      login: jest.fn(),
      logout: jest.fn(),
    });
    (tournamentApi.getTournament as jest.Mock).mockResolvedValue(TOURNAMENT);
    (tournamentApi.unregisterEntry as jest.Mock).mockResolvedValue({});

    renderWithClient(<TournamentDetail tournamentId="trn-1" />);
    await waitFor(() => expect(screen.getByText('Cancelar inscrição')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Cancelar inscrição'));
    await waitFor(() =>
      expect(tournamentApi.unregisterEntry).toHaveBeenCalledWith('trn-1', expect.any(String)),
    );
  });

  it('não mostra a opção de cancelar depois que o torneio começou', async () => {
    mockedUseSession.mockReturnValue({
      clubeRole: ClubeRole.PLAYER,
      user: { id: 'other', email: 'other@x.dev', name: 'Outro' },
      status: 'authenticated',
      login: jest.fn(),
      logout: jest.fn(),
    });
    (tournamentApi.getTournament as jest.Mock).mockResolvedValue({
      ...TOURNAMENT,
      status: 'RUNNING' as const,
    });

    renderWithClient(<TournamentDetail tournamentId="trn-1" />);
    await waitFor(() =>
      expect(screen.getByText('Você está inscrito neste torneio.')).toBeInTheDocument(),
    );
    expect(screen.queryByText('Cancelar inscrição')).not.toBeInTheDocument();
  });

  it('destaca mesa e assento do jogador e repete na linha da listagem', async () => {
    mockedUseSession.mockReturnValue({
      clubeRole: ClubeRole.PLAYER,
      user: { id: 'other', email: 'other@x.dev', name: 'Outro' },
      status: 'authenticated',
      login: jest.fn(),
      logout: jest.fn(),
    });
    (tournamentApi.getTournament as jest.Mock).mockResolvedValue(TOURNAMENT_SEATED);

    renderWithClient(<TournamentDetail tournamentId="trn-1" />);

    await waitFor(() => expect(screen.getByText('Mesa 3 · Assento 7')).toBeInTheDocument());
    expect(screen.queryByText('Você está inscrito neste torneio.')).not.toBeInTheDocument();
    expect(screen.getByText('10000 fichas · Mesa 3 · Assento 7')).toBeInTheDocument();
  });

  it('omite o destaque quando tableNumber/seatNumber são null', async () => {
    mockedUseSession.mockReturnValue({
      clubeRole: ClubeRole.PLAYER,
      user: { id: 'other', email: 'other@x.dev', name: 'Outro' },
      status: 'authenticated',
      login: jest.fn(),
      logout: jest.fn(),
    });
    (tournamentApi.getTournament as jest.Mock).mockResolvedValue(TOURNAMENT);

    renderWithClient(<TournamentDetail tournamentId="trn-1" />);

    await waitFor(() =>
      expect(screen.getByText('Você está inscrito neste torneio.')).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Mesa/)).not.toBeInTheDocument();
    expect(screen.getByText('10000 fichas')).toBeInTheDocument();
  });

  it('ADMIN pode eliminar uma inscrição e encerrar o torneio', async () => {
    mockedUseSession.mockReturnValue({
      clubeRole: ClubeRole.ADMIN,
      user: { id: 'admin', email: 'admin@x.dev', name: 'Admin' },
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

  it('ADMIN pode cancelar a inscrição de outro jogador antes do torneio começar', async () => {
    mockedUseSession.mockReturnValue({
      clubeRole: ClubeRole.ADMIN,
      user: { id: 'admin', email: 'admin@x.dev', name: 'Admin' },
      status: 'authenticated',
      login: jest.fn(),
      logout: jest.fn(),
    });
    (tournamentApi.getTournament as jest.Mock).mockResolvedValue(TOURNAMENT);
    (tournamentApi.unregisterEntryForUser as jest.Mock).mockResolvedValue({});

    renderWithClient(<TournamentDetail tournamentId="trn-1" />);
    await waitFor(() => expect(screen.getByText('Cancelar inscrição')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Cancelar inscrição'));
    await waitFor(() =>
      expect(tournamentApi.unregisterEntryForUser).toHaveBeenCalledWith(
        'trn-1',
        'other',
        expect.any(String),
      ),
    );
  });

  it('ADMIN não vê a opção de cancelar inscrição de outro jogador depois que o torneio começou', async () => {
    mockedUseSession.mockReturnValue({
      clubeRole: ClubeRole.ADMIN,
      user: { id: 'admin', email: 'admin@x.dev', name: 'Admin' },
      status: 'authenticated',
      login: jest.fn(),
      logout: jest.fn(),
    });
    (tournamentApi.getTournament as jest.Mock).mockResolvedValue({
      ...TOURNAMENT,
      status: 'RUNNING' as const,
    });

    renderWithClient(<TournamentDetail tournamentId="trn-1" />);
    await waitFor(() => expect(screen.getByText('Eliminar')).toBeInTheDocument());
    expect(screen.queryByText('Cancelar inscrição')).not.toBeInTheDocument();
  });

  it('linka mesas, relógio e TV — a TV em nova aba', async () => {
    mockedUseSession.mockReturnValue({
      clubeRole: ClubeRole.PLAYER,
      user: { id: 'me', email: 'me@x.dev', name: 'Eu' },
      status: 'authenticated',
      login: jest.fn(),
      logout: jest.fn(),
    });
    (tournamentApi.getTournament as jest.Mock).mockResolvedValue(TOURNAMENT);

    renderWithClient(<TournamentDetail tournamentId="trn-1" />);
    await waitFor(() => expect(screen.getByText('Ver mesas')).toBeInTheDocument());

    expect(screen.getByText('Ver mesas')).toHaveAttribute('href', '/tournaments/trn-1/tables');
    expect(screen.getByText('Controlar relógio')).toHaveAttribute(
      'href',
      '/tournaments/trn-1/clock',
    );

    const tv = screen.getByText('Tela de TV');
    expect(tv).toHaveAttribute('href', '/display/tournaments/trn-1');
    expect(tv).toHaveAttribute('target', '_blank');
    expect(tv).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('ADMIN vê "Editar" só quando REGISTERING e ninguém se inscreveu, e volta ao clicar em Cancelar', async () => {
    mockedUseSession.mockReturnValue({
      clubeRole: ClubeRole.ADMIN,
      user: { id: 'admin', email: 'admin@x.dev', name: 'Admin' },
      status: 'authenticated',
      login: jest.fn(),
      logout: jest.fn(),
    });
    (tournamentApi.getTournament as jest.Mock).mockResolvedValue({
      ...TOURNAMENT,
      registeredPlayers: 0,
      entries: [],
    });

    renderWithClient(<TournamentDetail tournamentId="trn-1" />);
    await waitFor(() => expect(screen.getByText('Editar')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Editar'));
    await waitFor(() => expect(screen.getByText('Editar torneio')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Cancelar'));
    await waitFor(() => expect(screen.getByText('Editar')).toBeInTheDocument());
  });

  it('não mostra "Editar" quando já tem gente inscrita', async () => {
    mockedUseSession.mockReturnValue({
      clubeRole: ClubeRole.ADMIN,
      user: { id: 'admin', email: 'admin@x.dev', name: 'Admin' },
      status: 'authenticated',
      login: jest.fn(),
      logout: jest.fn(),
    });
    (tournamentApi.getTournament as jest.Mock).mockResolvedValue(TOURNAMENT); // registeredPlayers: 1

    renderWithClient(<TournamentDetail tournamentId="trn-1" />);
    await waitFor(() => expect(screen.getByText(TOURNAMENT.name)).toBeInTheDocument());

    expect(screen.queryByText('Editar')).not.toBeInTheDocument();
  });

  it('não mostra "Editar" para quem não é ADMIN', async () => {
    mockedUseSession.mockReturnValue({
      clubeRole: ClubeRole.PLAYER,
      user: { id: 'me', email: 'me@x.dev', name: 'Eu' },
      status: 'authenticated',
      login: jest.fn(),
      logout: jest.fn(),
    });
    (tournamentApi.getTournament as jest.Mock).mockResolvedValue({
      ...TOURNAMENT,
      registeredPlayers: 0,
      entries: [],
    });

    renderWithClient(<TournamentDetail tournamentId="trn-1" />);
    await waitFor(() => expect(screen.getByText(TOURNAMENT.name)).toBeInTheDocument());

    expect(screen.queryByText('Editar')).not.toBeInTheDocument();
  });

  it('ADMIN busca um membro, revisa o modal de confirmação e inscreve em nome dele', async () => {
    mockedUseSession.mockReturnValue({
      clubeRole: ClubeRole.ADMIN,
      user: { id: 'admin', email: 'admin@x.dev', name: 'Admin' },
      status: 'authenticated',
      login: jest.fn(),
      logout: jest.fn(),
    });
    (tournamentApi.getTournament as jest.Mock).mockResolvedValue({
      ...TOURNAMENT,
      staffBonusCost: '5.00',
      staffBonusChips: 2_500,
    });
    (clubMembersApi.listMembers as jest.Mock).mockResolvedValue([
      {
        id: 'mem-2',
        userId: 'user-2',
        name: 'Novo Jogador',
        email: 'novo@x.dev',
        document: null,
        role: 'PLAYER',
        status: 'ACTIVE',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    (tournamentApi.registerEntryForUser as jest.Mock).mockResolvedValue({});

    renderWithClient(<TournamentDetail tournamentId="trn-1" />);
    await waitFor(() => expect(screen.getByText('Inscrever jogador')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('Nome, e-mail ou CPF'), {
      target: { value: 'novo' },
    });
    await waitFor(() => expect(screen.getByText('Novo Jogador')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Inscrever'));

    // Modal mostra pra quem/qual torneio/valores antes de confirmar — escopado
    // ao próprio diálogo porque "Sunday Major"/"R$ 90,00" também aparecem no
    // card de topo, atrás dele.
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByRole('heading', { name: 'Confirmar inscrição' })).toBeInTheDocument();
    expect(dialog.getByText(/Novo Jogador/)).toBeInTheDocument();
    expect(dialog.getByText(TOURNAMENT.name)).toBeInTheDocument();
    expect(dialog.getByText('R$ 90,00')).toBeInTheDocument(); // buy-in
    expect(dialog.getByText('R$ 10,00')).toBeInTheDocument(); // taxa

    fireEvent.click(dialog.getByRole('checkbox', { name: /bônus de staff/i }));
    fireEvent.click(dialog.getByRole('button', { name: 'Confirmar inscrição' }));

    await waitFor(() =>
      expect(tournamentApi.registerEntryForUser).toHaveBeenCalledWith(
        'trn-1',
        'user-2',
        expect.any(String),
        { staffBonus: true },
      ),
    );
    // Fecha o modal e limpa a busca depois de inscrever.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('mostra mensagem de erro quando a query falha', async () => {
    mockedUseSession.mockReturnValue({
      clubeRole: ClubeRole.PLAYER,
      user: { id: 'me', email: 'me@x.dev', name: 'Eu' },
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
