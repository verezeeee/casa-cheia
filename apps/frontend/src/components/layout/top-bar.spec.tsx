import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { useSession } from '@/components/providers/session-provider';
import { TopBar } from './top-bar';

jest.mock('@/components/providers/session-provider', () => ({
  useSession: jest.fn(),
}));

jest.mock('@/lib/api/club-context', () => ({
  clubApi: { createClube: jest.fn(), joinClube: jest.fn() },
}));

const mockedUseSession = jest.mocked(useSession);

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('TopBar', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('mostra o nome do usuário e o wordmark linkando para /lobby', () => {
    mockedUseSession.mockReturnValue({
      status: 'authenticated',
      user: { id: '1', email: 'a@b.dev', name: 'Ana' },
      clubeRole: null,
      login: jest.fn(),
      logout: jest.fn(),
      clubes: [],
      currentClubeId: null,
      switchClube: jest.fn(),
      refreshClubes: jest.fn(),
    });

    renderWithClient(<TopBar />);

    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Casa Cheia/ })).toHaveAttribute('href', '/lobby');
  });

  it('chama logout ao clicar em Sair', () => {
    const logout = jest.fn();
    mockedUseSession.mockReturnValue({
      status: 'authenticated',
      user: { id: '1', email: 'a@b.dev', name: 'Ana' },
      clubeRole: null,
      login: jest.fn(),
      logout,
      clubes: [],
      currentClubeId: null,
      switchClube: jest.fn(),
      refreshClubes: jest.fn(),
    });

    renderWithClient(<TopBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Sair' }));

    expect(logout).toHaveBeenCalledTimes(1);
  });
});
