import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { useSession } from '@/components/providers/session-provider';
import { ClubActions } from './club-actions';

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

describe('ClubActions', () => {
  beforeEach(() => {
    mockedUseSession.mockReturnValue({
      switchClube: jest.fn(),
      refreshClubes: jest.fn(),
    } as never);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('abre o modal de criar clube', () => {
    renderWithClient(<ClubActions />);
    fireEvent.click(screen.getByRole('button', { name: '+ Criar clube' }));
    expect(screen.getByRole('heading', { name: 'Criar clube' })).toBeInTheDocument();
  });

  it('abre o modal de entrar com código', () => {
    renderWithClient(<ClubActions />);
    fireEvent.click(screen.getByRole('button', { name: 'Entrar com código' }));
    expect(screen.getByRole('heading', { name: 'Entrar com código' })).toBeInTheDocument();
  });
});
