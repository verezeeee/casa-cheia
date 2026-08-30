import type { TournamentDetailResponse } from '@poker-system/shared';
import { TournamentStatus } from '@poker-system/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { blindStructureApi } from '@/lib/api/blind-structure';
import { tournamentApi } from '@/lib/api/tournament';
import { EditTournamentForm } from './edit-tournament-form';

jest.mock('@/lib/api/tournament', () => ({
  tournamentApi: { updateTournament: jest.fn() },
}));

jest.mock('@/lib/api/blind-structure', () => ({
  blindStructureApi: { listBlindStructures: jest.fn() },
}));

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

const TOURNAMENT: TournamentDetailResponse = {
  id: 'trn-1',
  name: 'Sunday Major',
  buyIn: '90.00',
  fee: '10.00',
  staffBonusCost: null,
  staffBonusChips: null,
  maxPlayers: 100,
  registeredPlayers: 0,
  status: TournamentStatus.REGISTERING,
  startsAt: '2026-09-01T20:00:00.000Z',
  startingStack: 10_000,
  tableCapacity: 9,
  lateRegUntil: null,
  guaranteedPrize: null,
  blindStructureId: null,
  allowReentry: false,
  maxReentries: null,
  reentryUntilLevel: null,
  prizes: [{ position: 1, percentage: '100.00' }],
  entries: [],
};

describe('EditTournamentForm', () => {
  beforeEach(() => {
    (blindStructureApi.listBlindStructures as jest.Mock).mockResolvedValue([]);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('pré-popula os campos com os valores atuais do torneio', () => {
    renderWithClient(<EditTournamentForm tournament={TOURNAMENT} onClose={jest.fn()} />);

    expect(screen.getByLabelText('Nome')).toHaveValue('Sunday Major');
    expect(screen.getByLabelText('Buy-in')).toHaveValue('90.00');
    expect(screen.getByLabelText('Taxa (fee)')).toHaveValue('10.00');
    expect(screen.getByLabelText('Fichas iniciais')).toHaveValue(10_000);
    // `startsAt` chega em UTC; o input é local — só confere que não ficou vazio.
    expect(screen.getByLabelText('Início')).not.toHaveValue('');
  });

  it('salva as mudanças chamando updateTournament com o id do torneio', async () => {
    (tournamentApi.updateTournament as jest.Mock).mockResolvedValue({ id: 'trn-1' });

    renderWithClient(<EditTournamentForm tournament={TOURNAMENT} onClose={jest.fn()} />);
    fireEvent.change(screen.getByLabelText('Nome'), {
      target: { value: 'Sunday Major (editado)' },
    });
    fireEvent.change(screen.getByLabelText('Buy-in'), { target: { value: '100.00' } });
    fireEvent.click(screen.getByText('Salvar'));

    await waitFor(() =>
      expect(tournamentApi.updateTournament).toHaveBeenCalledWith(
        'trn-1',
        expect.objectContaining({ name: 'Sunday Major (editado)', buyIn: '100.00' }),
      ),
    );
  });

  it('chama onClose depois de salvar com sucesso', async () => {
    (tournamentApi.updateTournament as jest.Mock).mockResolvedValue({ id: 'trn-1' });
    const onClose = jest.fn();

    renderWithClient(<EditTournamentForm tournament={TOURNAMENT} onClose={onClose} />);
    fireEvent.click(screen.getByText('Salvar'));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('chama onClose ao cancelar, sem salvar nada', () => {
    const onClose = jest.fn();
    renderWithClient(<EditTournamentForm tournament={TOURNAMENT} onClose={onClose} />);

    fireEvent.click(screen.getByText('Cancelar'));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(tournamentApi.updateTournament).not.toHaveBeenCalled();
  });

  it('pré-popula o bônus de staff quando o torneio já oferece', () => {
    renderWithClient(
      <EditTournamentForm
        tournament={{ ...TOURNAMENT, staffBonusCost: '5.00', staffBonusChips: 2_500 }}
        onClose={jest.fn()}
      />,
    );

    expect(screen.getByLabelText('Oferece bônus de staff (staff add-on)')).toBeChecked();
    expect(screen.getByLabelText('Custo do bônus')).toHaveValue('5.00');
    expect(screen.getByLabelText('Fichas extras')).toHaveValue(2_500);
  });

  it('mostra o erro da API quando a edição falha', async () => {
    (tournamentApi.updateTournament as jest.Mock).mockRejectedValue(new Error('falhou'));

    renderWithClient(<EditTournamentForm tournament={TOURNAMENT} onClose={jest.fn()} />);
    fireEvent.click(screen.getByText('Salvar'));

    await waitFor(() =>
      expect(screen.getByText('Não foi possível salvar o torneio.')).toBeInTheDocument(),
    );
  });
});
