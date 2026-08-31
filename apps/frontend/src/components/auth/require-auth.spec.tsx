import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useSession } from '@/components/providers/session-provider';
import { RequireAuth } from './require-auth';

// `Sidebar` (montada sempre que autenticado) inclui o `ClubSwitcher`, que usa
// `useMutation` (`CreateClubeDialog`/`JoinClubeDialog`) — precisa de um
// `QueryClientProvider` na árvore mesmo quando o teste não mexe com clubes.
function renderWithClient(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

jest.mock('@/components/providers/session-provider', () => ({
  useSession: jest.fn(),
}));

const replace = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/lobby',
}));

const mockedUseSession = jest.mocked(useSession);

const BASE_SESSION = {
  clubeRole: null,
  clubes: [],
  currentClubeId: null,
  login: jest.fn(),
  logout: jest.fn(),
  switchClube: jest.fn(),
  refreshClubes: jest.fn(),
};

describe('RequireAuth', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('mostra um spinner (e não redireciona) enquanto a sessão está carregando', () => {
    mockedUseSession.mockReturnValue({
      ...BASE_SESSION,
      status: 'loading',
      user: null,
    });

    renderWithClient(
      <RequireAuth>
        <p>conteúdo protegido</p>
      </RequireAuth>,
    );

    expect(screen.queryByText('conteúdo protegido')).not.toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('redireciona para /login quando não autenticado', () => {
    mockedUseSession.mockReturnValue({
      ...BASE_SESSION,
      status: 'unauthenticated',
      user: null,
    });

    renderWithClient(
      <RequireAuth>
        <p>conteúdo protegido</p>
      </RequireAuth>,
    );

    expect(replace).toHaveBeenCalledWith('/login');
    expect(screen.queryByText('conteúdo protegido')).not.toBeInTheDocument();
  });

  it('renderiza os filhos quando autenticado e com clube', () => {
    mockedUseSession.mockReturnValue({
      ...BASE_SESSION,
      status: 'authenticated',
      user: { id: '1', email: 'a@b.dev', name: 'A' },
      clubes: [{ id: 'clube-1', name: 'Casa Cheia', status: 'ACTIVE', role: 'PLAYER' } as never],
      currentClubeId: 'clube-1',
    });

    renderWithClient(
      <RequireAuth>
        <p>conteúdo protegido</p>
      </RequireAuth>,
    );

    expect(screen.getByText('conteúdo protegido')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('sem clube nenhum, mostra a tela de convite em vez dos filhos', () => {
    mockedUseSession.mockReturnValue({
      ...BASE_SESSION,
      status: 'authenticated',
      user: { id: '1', email: 'a@b.dev', name: 'A' },
    });

    renderWithClient(
      <RequireAuth>
        <p>conteúdo protegido</p>
      </RequireAuth>,
    );

    expect(screen.queryByText('conteúdo protegido')).not.toBeInTheDocument();
    expect(screen.getByText('Você ainda não faz parte de nenhum clube')).toBeInTheDocument();
  });
});
