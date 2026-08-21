import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { walletApi } from '@/lib/api/wallet';
import { BalanceCard } from './balance-card';

jest.mock('@/lib/api/wallet', () => ({
  walletApi: { getBalance: jest.fn() },
}));

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('BalanceCard', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  it('mostra o saldo formatado em BRL quando a query resolve', async () => {
    (walletApi.getBalance as jest.Mock).mockResolvedValue({ balance: '1234.50', version: 3 });

    renderWithClient(<BalanceCard />);

    await waitFor(() => expect(screen.getByText('R$ 1.234,50')).toBeInTheDocument());
  });

  it('mostra mensagem de erro quando a query falha', async () => {
    (walletApi.getBalance as jest.Mock).mockRejectedValue(new Error('falhou'));

    renderWithClient(<BalanceCard />);

    await waitFor(() =>
      expect(screen.getByText('Não foi possível carregar o saldo.')).toBeInTheDocument(),
    );
  });
});
