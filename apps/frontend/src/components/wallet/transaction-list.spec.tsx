import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { walletApi } from '@/lib/api/wallet';
import { TransactionList } from './transaction-list';

jest.mock('@/lib/api/wallet', () => ({
  walletApi: { getTransactions: jest.fn() },
}));

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

const TRANSACTION = {
  id: 'txn_1',
  type: 'PIX_DEPOSIT' as const,
  status: 'COMPLETED' as const,
  amount: '100.00',
  balanceAfter: '100.00',
  description: null,
  createdAt: '2026-01-01T12:00:00.000Z',
};

describe('TransactionList', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  it('mostra estado vazio quando não há transações', async () => {
    (walletApi.getTransactions as jest.Mock).mockResolvedValue({ items: [], nextCursor: null });

    renderWithClient(<TransactionList />);

    await waitFor(() => expect(screen.getByText('Nenhuma movimentação ainda')).toBeInTheDocument());
  });

  it('lista as transações da primeira página', async () => {
    (walletApi.getTransactions as jest.Mock).mockResolvedValue({
      items: [TRANSACTION],
      nextCursor: null,
    });

    renderWithClient(<TransactionList />);

    await waitFor(() => expect(screen.getByText('Depósito PIX')).toBeInTheDocument());
    expect(screen.getByText('R$ 100,00')).toBeInTheDocument();
    expect(screen.queryByText('Carregar mais')).not.toBeInTheDocument();
  });

  it('busca a próxima página ao clicar em "Carregar mais"', async () => {
    (walletApi.getTransactions as jest.Mock)
      .mockResolvedValueOnce({ items: [TRANSACTION], nextCursor: 'cursor-1' })
      .mockResolvedValueOnce({ items: [{ ...TRANSACTION, id: 'txn_2' }], nextCursor: null });

    renderWithClient(<TransactionList />);

    await waitFor(() => expect(screen.getByText('Carregar mais')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Carregar mais'));

    await waitFor(() => expect(walletApi.getTransactions).toHaveBeenCalledWith('cursor-1'));
    await waitFor(() => expect(screen.queryByText('Carregar mais')).not.toBeInTheDocument());
  });

  it('mostra mensagem de erro quando a query falha', async () => {
    (walletApi.getTransactions as jest.Mock).mockRejectedValue(new Error('falhou'));

    renderWithClient(<TransactionList />);

    await waitFor(() =>
      expect(screen.getByText('Não foi possível carregar o extrato.')).toBeInTheDocument(),
    );
  });
});
