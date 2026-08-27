import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { blindStructureApi } from '@/lib/api/blind-structure';
import { tournamentApi } from '@/lib/api/tournament';
import { CreateTournamentForm } from './create-tournament-form';

jest.mock('@/lib/api/tournament', () => ({
  tournamentApi: { createTournament: jest.fn() },
}));

jest.mock('@/lib/api/blind-structure', () => ({
  blindStructureApi: { listBlindStructures: jest.fn() },
}));

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Sunday Major' } });
  fireEvent.change(screen.getByLabelText('Buy-in'), { target: { value: '90.00' } });
  fireEvent.change(screen.getByLabelText('Taxa (fee)'), { target: { value: '10.00' } });
  fireEvent.change(screen.getByLabelText('Início'), {
    target: { value: '2026-09-01T20:00' },
  });
}

describe('CreateTournamentForm', () => {
  beforeEach(() => {
    (blindStructureApi.listBlindStructures as jest.Mock).mockResolvedValue([]);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('abre o formulário, cria o torneio com a grade padrão e fecha de volta ao botão', async () => {
    (tournamentApi.createTournament as jest.Mock).mockResolvedValue({ id: 'trn-1' });

    renderWithClient(<CreateTournamentForm />);
    fireEvent.click(screen.getByText('+ Criar torneio'));
    fillRequiredFields();
    fireEvent.click(screen.getByText('Criar torneio'));

    await waitFor(() =>
      expect(tournamentApi.createTournament).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Sunday Major',
          buyIn: '90.00',
          fee: '10.00',
          tableCapacity: 9,
          blindStructureId: undefined,
          allowReentry: false,
          maxReentries: undefined,
          reentryUntilLevel: undefined,
          prizes: [{ position: 1, percentage: '100.00' }],
        }),
      ),
    );
    await waitFor(() => expect(screen.getByText('+ Criar torneio')).toBeInTheDocument());
  });

  it('envia tableCapacity e a estrutura de blinds escolhida', async () => {
    (blindStructureApi.listBlindStructures as jest.Mock).mockResolvedValue([
      { id: 'bs-1', name: 'Turbo 20 min', levels: [] },
    ]);
    (tournamentApi.createTournament as jest.Mock).mockResolvedValue({ id: 'trn-1' });

    renderWithClient(<CreateTournamentForm />);
    fireEvent.click(screen.getByText('+ Criar torneio'));
    fillRequiredFields();
    await waitFor(() => expect(screen.getByText('Turbo 20 min')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Jogadores por mesa'), { target: { value: '6' } });
    fireEvent.change(screen.getByLabelText('Estrutura de blinds (opcional)'), {
      target: { value: 'bs-1' },
    });
    fireEvent.click(screen.getByText('Criar torneio'));

    await waitFor(() =>
      expect(tournamentApi.createTournament).toHaveBeenCalledWith(
        expect.objectContaining({ tableCapacity: 6, blindStructureId: 'bs-1' }),
      ),
    );
  });

  it('aponta para o cadastro de estruturas quando o catálogo está vazio', async () => {
    renderWithClient(<CreateTournamentForm />);
    fireEvent.click(screen.getByText('+ Criar torneio'));

    await waitFor(() =>
      expect(screen.getByText(/Nenhuma estrutura cadastrada/)).toBeInTheDocument(),
    );
    expect(screen.getByText('Estruturas de blinds')).toHaveAttribute('href', '/blind-structures');
  });

  it('só revela os limites de reentry depois de marcar o checkbox', async () => {
    (tournamentApi.createTournament as jest.Mock).mockResolvedValue({ id: 'trn-1' });

    renderWithClient(<CreateTournamentForm />);
    fireEvent.click(screen.getByText('+ Criar torneio'));
    fillRequiredFields();

    expect(screen.queryByLabelText('Máximo de reentradas (opcional)')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Permite reentry'));
    fireEvent.change(screen.getByLabelText('Máximo de reentradas (opcional)'), {
      target: { value: '2' },
    });
    fireEvent.change(screen.getByLabelText('Reentry até o nível (opcional)'), {
      target: { value: '6' },
    });
    fireEvent.click(screen.getByText('Criar torneio'));

    await waitFor(() =>
      expect(tournamentApi.createTournament).toHaveBeenCalledWith(
        expect.objectContaining({
          allowReentry: true,
          maxReentries: 2,
          reentryUntilLevel: 6,
        }),
      ),
    );
  });

  it('permite adicionar uma colocação premiada extra', async () => {
    (tournamentApi.createTournament as jest.Mock).mockResolvedValue({ id: 'trn-1' });

    renderWithClient(<CreateTournamentForm />);
    fireEvent.click(screen.getByText('+ Criar torneio'));
    fillRequiredFields();
    fireEvent.change(screen.getByPlaceholderText('40.00'), { target: { value: '70.00' } });
    fireEvent.click(screen.getByText('+ Colocação premiada'));
    const percentageInputs = screen.getAllByPlaceholderText('40.00');
    fireEvent.change(percentageInputs[1]!, { target: { value: '30.00' } });
    fireEvent.click(screen.getByText('Criar torneio'));

    await waitFor(() =>
      expect(tournamentApi.createTournament).toHaveBeenCalledWith(
        expect.objectContaining({
          prizes: [
            { position: 1, percentage: '70.00' },
            { position: 2, percentage: '30.00' },
          ],
        }),
      ),
    );
  });

  it('mostra o erro da API quando a criação falha', async () => {
    (tournamentApi.createTournament as jest.Mock).mockRejectedValue(new Error('falhou'));

    renderWithClient(<CreateTournamentForm />);
    fireEvent.click(screen.getByText('+ Criar torneio'));
    fillRequiredFields();
    fireEvent.click(screen.getByText('Criar torneio'));

    await waitFor(() =>
      expect(screen.getByText('Não foi possível criar o torneio.')).toBeInTheDocument(),
    );
  });
});
