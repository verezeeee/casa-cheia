import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { tableApi } from '@/lib/api/table';
import { CreateTableForm } from './create-table-form';

jest.mock('@/lib/api/table', () => ({
  tableApi: { createTable: jest.fn() },
}));

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('CreateTableForm', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  it('abre o formulário, cria a mesa e fecha de volta ao botão', async () => {
    (tableApi.createTable as jest.Mock).mockResolvedValue({ id: 'table-1' });

    renderWithClient(<CreateTableForm />);
    fireEvent.click(screen.getByText('+ Criar mesa'));

    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Mesa 1' } });
    fireEvent.change(screen.getByLabelText('Small blind'), { target: { value: '1.00' } });
    fireEvent.change(screen.getByLabelText('Big blind'), { target: { value: '2.00' } });
    fireEvent.change(screen.getByLabelText('Buy-in mínimo'), { target: { value: '40.00' } });
    fireEvent.change(screen.getByLabelText('Buy-in máximo'), { target: { value: '200.00' } });
    fireEvent.click(screen.getByText('Criar mesa'));

    await waitFor(() =>
      expect(tableApi.createTable).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Mesa 1', smallBlind: '1.00' }),
      ),
    );
    await waitFor(() => expect(screen.getByText('+ Criar mesa')).toBeInTheDocument());
  });

  it('mostra o erro da API quando a criação falha', async () => {
    (tableApi.createTable as jest.Mock).mockRejectedValue(new Error('falhou'));

    renderWithClient(<CreateTableForm />);
    fireEvent.click(screen.getByText('+ Criar mesa'));
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Mesa 1' } });
    fireEvent.change(screen.getByLabelText('Small blind'), { target: { value: '1.00' } });
    fireEvent.change(screen.getByLabelText('Big blind'), { target: { value: '2.00' } });
    fireEvent.change(screen.getByLabelText('Buy-in mínimo'), { target: { value: '40.00' } });
    fireEvent.change(screen.getByLabelText('Buy-in máximo'), { target: { value: '200.00' } });
    fireEvent.click(screen.getByText('Criar mesa'));

    await waitFor(() =>
      expect(screen.getByText('Não foi possível criar a mesa.')).toBeInTheDocument(),
    );
  });
});
