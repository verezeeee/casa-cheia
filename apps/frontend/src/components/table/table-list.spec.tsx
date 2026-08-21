import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { tableApi } from '@/lib/api/table';
import { TableList } from './table-list';

jest.mock('@/lib/api/table', () => ({
  tableApi: { listTables: jest.fn() },
}));

// next/link renderiza um <a>; sem mock nenhum é necessário em jsdom.

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

const TABLE = {
  id: 'table-1',
  name: 'NL Holdem 1/2',
  type: 'CASH_GAME' as const,
  smallBlind: '1.00',
  bigBlind: '2.00',
  minBuyIn: '40.00',
  maxBuyIn: '200.00',
  maxSeats: 6,
  occupiedSeats: 2,
  status: 'OPEN' as const,
};

describe('TableList', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  it('mostra estado vazio quando não há mesas', async () => {
    (tableApi.listTables as jest.Mock).mockResolvedValue({ items: [], nextCursor: null });
    renderWithClient(<TableList />);
    await waitFor(() => expect(screen.getByText('Nenhuma mesa aberta')).toBeInTheDocument());
  });

  it('lista as mesas com link para o detalhe', async () => {
    (tableApi.listTables as jest.Mock).mockResolvedValue({ items: [TABLE], nextCursor: null });
    renderWithClient(<TableList />);

    await waitFor(() => expect(screen.getByText('NL Holdem 1/2')).toBeInTheDocument());
    expect(screen.getByText('2/6 assentos ocupados')).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/tables/table-1');
  });

  it('mostra mensagem de erro quando a query falha', async () => {
    (tableApi.listTables as jest.Mock).mockRejectedValue(new Error('falhou'));
    renderWithClient(<TableList />);
    await waitFor(() =>
      expect(screen.getByText('Não foi possível carregar as mesas.')).toBeInTheDocument(),
    );
  });
});
