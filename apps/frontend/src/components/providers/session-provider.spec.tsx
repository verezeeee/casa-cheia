import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SessionUser } from '@poker-system/shared';
import type { ReactNode } from 'react';
import { authApi } from '@/lib/api/auth';
import { clubApi } from '@/lib/api/club-context';
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

// `resolveCurrentClube` (session-provider.tsx) chama isso a cada hidratação/
// login bem-sucedido — sem o mock, a suíte tentaria uma requisição real.
jest.mock('@/lib/api/club-context', () => ({
  clubApi: { listMyClubes: jest.fn() },
  setCurrentClubeId: jest.fn(),
}));

const mockedAuthApi = jest.mocked(authApi);
const mockedClubApi = jest.mocked(clubApi);

const sessionUser: SessionUser = {
  id: 'usr_1',
  email: 'player@poker.dev',
  name: 'Player One',
};

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>{children}</SessionProvider>
    </QueryClientProvider>
  );
}

describe('SessionProvider / useSession', () => {
  beforeEach(() => {
    // Sem clube ligado ao teste, por padrão — os testes deste arquivo cobrem
    // `user`/`status`, não `clubeRole` (isso vive em `club-context.spec.ts`).
    mockedClubApi.listMyClubes.mockResolvedValue([]);
  });

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

  it('expõe os clubes do usuário e o clube atual (primeiro da lista)', async () => {
    mockedAuthApi.me.mockResolvedValue(sessionUser);
    mockedClubApi.listMyClubes.mockResolvedValue([
      { id: 'clube-1', name: 'Casa Cheia', status: 'ACTIVE', role: 'ADMIN' } as never,
      { id: 'clube-2', name: 'Outro Clube', status: 'ACTIVE', role: 'PLAYER' } as never,
    ]);

    const { result } = renderHook(() => useSession(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('authenticated'));

    expect(result.current.clubes).toHaveLength(2);
    expect(result.current.currentClubeId).toBe('clube-1');
    expect(result.current.clubeRole).toBe('ADMIN');
  });

  it('switchClube troca o clube atual e o papel derivado', async () => {
    mockedAuthApi.me.mockResolvedValue(sessionUser);
    mockedClubApi.listMyClubes.mockResolvedValue([
      { id: 'clube-1', name: 'Casa Cheia', status: 'ACTIVE', role: 'ADMIN' } as never,
      { id: 'clube-2', name: 'Outro Clube', status: 'ACTIVE', role: 'PLAYER' } as never,
    ]);

    const { result } = renderHook(() => useSession(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('authenticated'));

    act(() => result.current.switchClube('clube-2'));

    expect(result.current.currentClubeId).toBe('clube-2');
    expect(result.current.clubeRole).toBe('PLAYER');
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
