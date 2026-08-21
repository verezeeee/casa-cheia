import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { tournamentApi } from '@/lib/api/tournament';
import { CreateTournamentForm } from './create-tournament-form';

jest.mock('@/lib/api/tournament', () => ({
  tournamentApi: { createTournament: jest.fn() },
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
          prizes: [{ position: 1, percentage: '100.00' }],
        }),
      ),
    );
    await waitFor(() => expect(screen.getByText('+ Criar torneio')).toBeInTheDocument());
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
