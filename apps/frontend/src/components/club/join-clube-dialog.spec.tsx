import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { clubApi } from '@/lib/api/club-context';
import { JoinClubeDialog } from './join-clube-dialog';

jest.mock('@/lib/api/club-context', () => ({
  clubApi: { joinClube: jest.fn() },
}));

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('JoinClubeDialog', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  it('entra no clube pelo código e chama onSuccess com o clube retornado', async () => {
    const clube = { id: 'clube-1', name: 'Casa Cheia', status: 'ACTIVE', role: 'PLAYER' };
    (clubApi.joinClube as jest.Mock).mockResolvedValue(clube);
    const onSuccess = jest.fn();
    const onClose = jest.fn();

    renderWithClient(<JoinClubeDialog open onClose={onClose} onSuccess={onSuccess} />);
    fireEvent.change(screen.getByLabelText('Código do clube'), { target: { value: '123456' } });
    fireEvent.click(screen.getByText('Entrar'));

    await waitFor(() => expect(clubApi.joinClube).toHaveBeenCalledWith({ code: '123456' }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(clube));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('mostra o erro da API quando o código é inválido', async () => {
    (clubApi.joinClube as jest.Mock).mockRejectedValue(new Error('Código inválido.'));

    renderWithClient(<JoinClubeDialog open onClose={jest.fn()} onSuccess={jest.fn()} />);
    fireEvent.change(screen.getByLabelText('Código do clube'), { target: { value: '999999' } });
    fireEvent.click(screen.getByText('Entrar'));

    await waitFor(() =>
      expect(screen.getByText('Não foi possível entrar no clube.')).toBeInTheDocument(),
    );
  });
});
