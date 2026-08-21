import { act, renderHook, waitFor } from '@testing-library/react';
import { UserRole, type SessionUser } from '@poker-system/shared';
import type { ReactNode } from 'react';
import { authApi } from '@/lib/api/auth';
import { SessionProvider, useSession } from './session-provider';

jest.mock('@/lib/api/auth', () => ({
  authApi: {
    register: jest.fn(),
    login: jest.fn(),
    logout: jest.fn(),
    refresh: jest.fn(),
    me: jest.fn(),
  },
}));

const mockedAuthApi = jest.mocked(authApi);

const sessionUser: SessionUser = {
  id: 'usr_1',
  email: 'player@poker.dev',
  name: 'Player One',
  role: UserRole.PLAYER,
};

function wrapper({ children }: { children: ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}

describe('SessionProvider / useSession', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  it('lança se usado fora do <SessionProvider>', () => {
    // Sem wrapper: renderHook sem provider deve lançar dentro do hook.
    expect(() => renderHook(() => useSession())).toThrow(/SessionProvider/);
  });

  it('hidrata como authenticated quando me() resolve na montagem', async () => {
    mockedAuthApi.me.mockResolvedValue(sessionUser);

    const { result } = renderHook(() => useSession(), { wrapper });

    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('authenticated'));
    expect(result.current.user).toEqual(sessionUser);
  });

  it('vira unauthenticated quando não há sessão válida (me() falha)', async () => {
    mockedAuthApi.me.mockRejectedValue(new Error('401'));

    const { result } = renderHook(() => useSession(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe('unauthenticated'));
    expect(result.current.user).toBeNull();
  });

  it('login() autentica e popula o usuário', async () => {
    mockedAuthApi.me
      .mockRejectedValueOnce(new Error('sem sessão ainda'))
      .mockResolvedValue(sessionUser);
    mockedAuthApi.login.mockResolvedValue({ accessToken: 'access-token', expiresIn: 900 });

    const { result } = renderHook(() => useSession(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('unauthenticated'));

    await act(async () => {
      await result.current.login({ email: sessionUser.email, password: 'S3nh@Forte' });
    });

    expect(mockedAuthApi.login).toHaveBeenCalledWith({
      email: sessionUser.email,
      password: 'S3nh@Forte',
    });
    expect(result.current.status).toBe('authenticated');
    expect(result.current.user).toEqual(sessionUser);
  });

  it('logout() limpa a sessão mesmo que a chamada ao backend falhe', async () => {
    mockedAuthApi.me.mockResolvedValue(sessionUser);
    mockedAuthApi.logout.mockRejectedValue(new Error('rede indisponível'));

    const { result } = renderHook(() => useSession(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('authenticated'));

    await act(async () => {
      await result.current.logout();
    });

    expect(result.current.status).toBe('unauthenticated');
    expect(result.current.user).toBeNull();
  });
});
