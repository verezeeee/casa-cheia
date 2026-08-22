import { fireEvent, render, screen } from '@testing-library/react';
import { UserRole } from '@poker-system/shared';
import { useSession } from '@/components/providers/session-provider';
import { TopBar } from './top-bar';

jest.mock('@/components/providers/session-provider', () => ({
  useSession: jest.fn(),
}));

const mockedUseSession = jest.mocked(useSession);

describe('TopBar', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('mostra o nome do usuário e o wordmark linkando para /lobby', () => {
    mockedUseSession.mockReturnValue({
      status: 'authenticated',
      user: { id: '1', email: 'a@b.dev', name: 'Ana', role: UserRole.PLAYER },
      login: jest.fn(),
      logout: jest.fn(),
    });

    render(<TopBar />);

    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Casa Cheia/ })).toHaveAttribute('href', '/lobby');
  });

  it('chama logout ao clicar em Sair', () => {
    const logout = jest.fn();
    mockedUseSession.mockReturnValue({
      status: 'authenticated',
      user: { id: '1', email: 'a@b.dev', name: 'Ana', role: UserRole.PLAYER },
      login: jest.fn(),
      logout,
    });

    render(<TopBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Sair' }));

    expect(logout).toHaveBeenCalledTimes(1);
  });
});
