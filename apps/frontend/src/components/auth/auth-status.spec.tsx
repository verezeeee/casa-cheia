import { render, screen } from '@testing-library/react';
import { useSession } from '@/components/providers/session-provider';
import { AuthStatus } from './auth-status';

jest.mock('@/components/providers/session-provider', () => ({
  useSession: jest.fn(),
}));

const mockedUseSession = jest.mocked(useSession);

describe('AuthStatus', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('mostra um spinner enquanto a sessão carrega', () => {
    mockedUseSession.mockReturnValue({
      status: 'loading',
      user: null,
      clubeRole: null,
      login: jest.fn(),
      logout: jest.fn(),
    });

    render(<AuthStatus />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('mostra links de Entrar/Cadastrar quando não autenticado', () => {
    mockedUseSession.mockReturnValue({
      status: 'unauthenticated',
      user: null,
      clubeRole: null,
      login: jest.fn(),
      logout: jest.fn(),
    });

    render(<AuthStatus />);
    expect(screen.getByRole('link', { name: 'Entrar' })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: 'Cadastrar' })).toHaveAttribute('href', '/register');
  });

  it('mostra o nome do usuário e um botão de Sair quando autenticado', () => {
    const logout = jest.fn();
    mockedUseSession.mockReturnValue({
      status: 'authenticated',
      user: { id: '1', email: 'a@b.dev', name: 'Ana' },
      clubeRole: null,
      login: jest.fn(),
      logout,
    });

    render(<AuthStatus />);
    expect(screen.getByText('Olá, Ana')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir para o lobby' })).toHaveAttribute('href', '/lobby');

    screen.getByRole('button', { name: 'Sair' }).click();
    expect(logout).toHaveBeenCalledTimes(1);
  });
});
