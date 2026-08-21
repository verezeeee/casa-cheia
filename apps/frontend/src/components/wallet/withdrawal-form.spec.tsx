import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { walletApi } from '@/lib/api/wallet';
import { ApiError } from '@/lib/http-client';
import { WithdrawalForm } from './withdrawal-form';

jest.mock('@/lib/api/wallet', () => ({
  walletApi: { requestWithdrawal: jest.fn() },
}));

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('WithdrawalForm', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  it('solicita o saque e mostra confirmação de sucesso', async () => {
    (walletApi.requestWithdrawal as jest.Mock).mockResolvedValue({
      id: 'wdr_1',
      amount: '30.00',
      status: 'PROCESSING',
      pixKeyMasked: '***.com',
      failureReason: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    renderWithClient(<WithdrawalForm />);

    fireEvent.change(screen.getByLabelText('Valor'), { target: { value: '30.00' } });
    fireEvent.change(screen.getByLabelText('Chave PIX'), { target: { value: 'a@b.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Solicitar saque' }));

    await waitFor(() =>
      expect(
        screen.getByText('Saque solicitado. O valor já foi debitado do seu saldo.'),
      ).toBeInTheDocument(),
    );
    expect(walletApi.requestWithdrawal).toHaveBeenCalledWith(
      { amount: '30.00', pixKey: 'a@b.com', pixKeyType: 'EMAIL' },
      expect.any(String) as unknown,
    );
  });

  it('mostra o erro da API quando o saque é recusado', async () => {
    (walletApi.requestWithdrawal as jest.Mock).mockRejectedValue(
      new ApiError({
        statusCode: 422,
        message: 'Saldo insuficiente.',
        timestamp: '',
        path: '/wallet/withdrawals',
      }),
    );

    renderWithClient(<WithdrawalForm />);

    fireEvent.change(screen.getByLabelText('Valor'), { target: { value: '30.00' } });
    fireEvent.change(screen.getByLabelText('Chave PIX'), { target: { value: 'a@b.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Solicitar saque' }));

    await waitFor(() => expect(screen.getByText('Saldo insuficiente.')).toBeInTheDocument());
  });
});
