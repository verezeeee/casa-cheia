import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { walletApi } from '@/lib/api/wallet';
import { ApiError } from '@/lib/http-client';
import { DepositForm } from './deposit-form';

jest.mock('@/lib/api/wallet', () => ({
  walletApi: { createDeposit: jest.fn() },
}));

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('DepositForm', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  it('cria a cobrança e mostra o copia-e-cola devolvido', async () => {
    (walletApi.createDeposit as jest.Mock).mockResolvedValue({
      id: 'chg_1',
      amount: '50.00',
      status: 'PENDING',
      qrCodePayload: '000201-copia-e-cola',
      qrCodeImageUrl: null,
      expiresAt: '2026-01-01T00:00:00.000Z',
    });

    renderWithClient(<DepositForm />);

    fireEvent.change(screen.getByLabelText('Valor'), { target: { value: '50.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gerar QR Code PIX' }));

    await waitFor(() =>
      expect(screen.getByDisplayValue('000201-copia-e-cola')).toBeInTheDocument(),
    );
    expect(walletApi.createDeposit).toHaveBeenCalledWith(
      { amount: '50.00' },
      expect.any(String) as unknown,
    );
  });

  it('mostra o erro da API quando a criação falha', async () => {
    (walletApi.createDeposit as jest.Mock).mockRejectedValue(
      new ApiError({
        statusCode: 400,
        message: 'Valor mínimo de depósito é R$ 10.00.',
        timestamp: '',
        path: '/wallet/deposits',
      }),
    );

    renderWithClient(<DepositForm />);

    fireEvent.change(screen.getByLabelText('Valor'), { target: { value: '1.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gerar QR Code PIX' }));

    await waitFor(() =>
      expect(screen.getByText('Valor mínimo de depósito é R$ 10.00.')).toBeInTheDocument(),
    );
  });
});
