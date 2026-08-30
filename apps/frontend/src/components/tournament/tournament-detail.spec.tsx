import { ClubeRole } from '@poker-system/shared';
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
    updateTournament: jest.fn(),
  },
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
