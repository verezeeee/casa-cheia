import { render, screen } from '@testing-library/react';
import { useSession } from '@/components/providers/session-provider';
import { RequireAuth } from './require-auth';

jest.mock('@/components/providers/session-provider', () => ({
  useSession: jest.fn(),
}));

const replace = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/lobby',
}));

const mockedUseSession = jest.mocked(useSession);

describe('RequireAuth', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('mostra um spinner (e não redireciona) enquanto a sessão está carregando', () => {
    mockedUseSession.mockReturnValue({
      status: 'loading',
      user: null,
      login: jest.fn(),
      logout: jest.fn(),
    });

    render(
      <RequireAuth>
        <p>conteúdo protegido</p>
      </RequireAuth>,
    );

    expect(screen.queryByText('conteúdo protegido')).not.toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('redireciona para /login quando não autenticado', () => {
    mockedUseSession.mockReturnValue({
      status: 'unauthenticated',
      user: null,
      login: jest.fn(),
      logout: jest.fn(),
    });

    render(
      <RequireAuth>
        <p>conteúdo protegido</p>
      </RequireAuth>,
    );

    expect(replace).toHaveBeenCalledWith('/login');
    expect(screen.queryByText('conteúdo protegido')).not.toBeInTheDocument();
  });

  it('renderiza os filhos quando autenticado', () => {
    mockedUseSession.mockReturnValue({
      status: 'authenticated',
      user: { id: '1', email: 'a@b.dev', name: 'A', role: 'PLAYER' } as never,
      login: jest.fn(),
      logout: jest.fn(),
    });

    render(
      <RequireAuth>
        <p>conteúdo protegido</p>
      </RequireAuth>,
    );

    expect(screen.getByText('conteúdo protegido')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});
