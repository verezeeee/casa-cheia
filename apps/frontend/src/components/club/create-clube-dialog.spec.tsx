import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { clubApi } from '@/lib/api/club-context';
import { CreateClubeDialog } from './create-clube-dialog';

jest.mock('@/lib/api/club-context', () => ({
  clubApi: { createClube: jest.fn() },
}));

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('CreateClubeDialog', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  it('cria o clube e chama onSuccess com o clube retornado', async () => {
    const clube = { id: 'clube-1', name: 'Casa Cheia', status: 'ACTIVE', role: 'ADMIN' };
    (clubApi.createClube as jest.Mock).mockResolvedValue(clube);
    const onSuccess = jest.fn();
    const onClose = jest.fn();

    renderWithClient(<CreateClubeDialog open onClose={onClose} onSuccess={onSuccess} />);
    fireEvent.change(screen.getByLabelText('Nome do clube'), { target: { value: 'Casa Cheia' } });
    fireEvent.change(screen.getByLabelText('CNPJ ou CPF'), {
      target: { value: '12345678000199' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Criar clube' }));

    await waitFor(() =>
      expect(clubApi.createClube).toHaveBeenCalledWith({
        name: 'Casa Cheia',
        document: '12345678000199',
      }),
    );
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(clube));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('mostra o erro da API quando a criação falha', async () => {
    (clubApi.createClube as jest.Mock).mockRejectedValue(new Error('falhou'));

    renderWithClient(<CreateClubeDialog open onClose={jest.fn()} onSuccess={jest.fn()} />);
    fireEvent.change(screen.getByLabelText('Nome do clube'), { target: { value: 'X' } });
    fireEvent.change(screen.getByLabelText('CNPJ ou CPF'), { target: { value: '12345678901' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar clube' }));

    await waitFor(() =>
      expect(screen.getByText('Não foi possível criar o clube.')).toBeInTheDocument(),
    );
  });

  it('aplica máscara de CPF/CNPJ e guarda só dígitos no campo de documento', () => {
    renderWithClient(<CreateClubeDialog open onClose={jest.fn()} onSuccess={jest.fn()} />);

    fireEvent.change(screen.getByLabelText('CNPJ ou CPF'), {
      target: { value: '123.456.789-01' },
    });
    expect(screen.getByLabelText('CNPJ ou CPF')).toHaveValue('123.456.789-01');

    fireEvent.change(screen.getByLabelText('CNPJ ou CPF'), {
      target: { value: '12345678000199' },
    });
    expect(screen.getByLabelText('CNPJ ou CPF')).toHaveValue('12.345.678/0001-99');
  });
});
