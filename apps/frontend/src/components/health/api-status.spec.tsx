import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { httpClient } from '@/lib/http-client';
import { ApiStatus } from './api-status';

jest.mock('@/lib/http-client', () => ({
  httpClient: { get: jest.fn() },
}));

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('ApiStatus', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  it('mostra "API online" quando o /health responde status ok', async () => {
    (httpClient.get as jest.Mock).mockResolvedValue({ status: 'ok', details: {} });

    renderWithClient(<ApiStatus />);

    expect(screen.getByText('Verificando API...')).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText('API online')).toBeInTheDocument());
  });

  it('mostra "API indisponível" quando a chamada falha', async () => {
    (httpClient.get as jest.Mock).mockRejectedValue(new Error('network error'));

    renderWithClient(<ApiStatus />);

    await waitFor(() => expect(screen.getByText('API indisponível')).toBeInTheDocument());
  });
});
