import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SessionUser } from '@poker-system/shared';
import type { ReactNode } from 'react';
import { clubApi } from '@/lib/api/club-context';
import { httpClient } from '@/lib/http-client';
import { SessionProvider, useSession } from './session-provider';

/**
 * Propositalmente SEM mockar `@/lib/api/auth`/`@/lib/http-client` (diferente
 * de `session-provider.spec.tsx`) — este teste precisa do fluxo REAL de
 * `401 -> unauthorizedHandler -> authApi.refresh()` pra reproduzir a corrida
 * entre a hidratação (mount) e um `login()` explícito. Mockar `authApi`
 * diretamente (como o outro arquivo faz) nunca passa por esse caminho, então
 * não pega essa classe de bug.
 */
jest.mock('@/lib/api/club-context', () => ({
  clubApi: { listMyClubes: jest.fn() },
  setCurrentClubeId: jest.fn(),
}));

const mockedClubApi = jest.mocked(clubApi);
const API_URL = 'http://localhost:3001/api';
const originalFetch = global.fetch;

const sessionUser: SessionUser = {
  id: 'usr_1',
  email: 'player@poker.dev',
  name: 'Player One',
};

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as Response;
}

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>{children}</SessionProvider>
    </QueryClientProvider>
  );
}

describe('SessionProvider — corrida hidratação × login (fluxo real de refresh)', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = API_URL;
    mockedClubApi.listMyClubes.mockResolvedValue([]);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.resetAllMocks();
  });

  it('login() bem-sucedido não é desfeito por um refresh de hidratação que perde a corrida e falha depois', async () => {
    let resolvePendingRefresh!: (response: Response) => void;
    const pendingRefresh = new Promise<Response>((resolve) => {
      resolvePendingRefresh = resolve;
    });

    let meCallCount = 0;
    global.fetch = jest.fn((url: unknown) => {
      const href = String(url);
      if (href === `${API_URL}/auth/me`) {
        meCallCount += 1;
        // 1ª chamada: hidratação, sem access token -> 401 (dispara o refresh
        // abaixo). Da 2ª em diante (chamada de dentro do `login()`, já com
        // access token novo) -> sucesso.
        return Promise.resolve(
          meCallCount === 1
            ? jsonResponse(
                { statusCode: 401, message: 'Não autenticado.', timestamp: '', path: '/auth/me' },
                401,
              )
            : jsonResponse(sessionUser),
        );
      }
      if (href === `${API_URL}/auth/refresh`) {
        // O refresh disparado pela HIDRATAÇÃO fica pendurado de propósito —
        // é a corrida com o `login()` explícito abaixo.
        return pendingRefresh;
      }
      if (href === `${API_URL}/auth/login`) {
        return Promise.resolve(jsonResponse({ accessToken: 'access-token-novo', expiresIn: 900 }));
      }
      return Promise.reject(new Error(`fetch não mockado para ${href}`));
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useSession(), { wrapper });

    // Espera a hidratação chegar no refresh pendurado antes de prosseguir.
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(`${API_URL}/auth/refresh`, expect.anything()),
    );

    await act(async () => {
      await result.current.login({ email: sessionUser.email, password: 'S3nh@Forte' });
    });

    expect(result.current.status).toBe('authenticated');
    expect(result.current.user).toEqual(sessionUser);

    // O refresh "velho" da hidratação finalmente resolve — com FALHA (401),
    // simulando o cookie já rotacionado/consumido enquanto estava em voo.
    // Sem a guarda de geração em `session-provider.tsx`, isso derrubaria
    // (`clearSession`) a sessão que o login já tinha acabado de estabelecer
    // — exatamente o bug relatado ("credenciais corretas, mas ao clicar em
    // entrar o sistema joga de volta pro login").
    await act(async () => {
      resolvePendingRefresh(
        jsonResponse(
          {
            statusCode: 401,
            message: 'Refresh token já utilizado.',
            timestamp: '',
            path: '/auth/refresh',
          },
          401,
        ),
      );
      // Deixa a cadeia de promises da hidratação (refresh -> catch -> me()
      // original rejeitando) drenar antes de checar o estado.
      await Promise.resolve().then().then().then();
    });

    expect(result.current.status).toBe('authenticated');
    expect(result.current.user).toEqual(sessionUser);
  });
});

describe('SessionProvider — falha transitória do refresh no meio da sessão (fluxo real)', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = API_URL;
    mockedClubApi.listMyClubes.mockResolvedValue([]);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.resetAllMocks();
  });

  it('um refresh que falha por erro de rede/timeout/5xx (não 401) não desloga uma sessão já estabelecida', async () => {
    let meCallCount = 0;
    let refreshCallCount = 0;
    global.fetch = jest.fn((url: unknown) => {
      const href = String(url);
      if (href === `${API_URL}/auth/me`) {
        meCallCount += 1;
        return Promise.resolve(
          meCallCount === 1
            ? jsonResponse(
                { statusCode: 401, message: 'Não autenticado.', timestamp: '', path: '/auth/me' },
                401,
              )
            : jsonResponse(sessionUser),
        );
      }
      if (href === `${API_URL}/auth/refresh`) {
        refreshCallCount += 1;
        // 1ª chamada (hidratação): sucesso normal. 2ª chamada (disparada
        // pela ação de negócio abaixo, já no meio da sessão): falha
        // TRANSITÓRIA — o `fetch` em si rejeita (queda de rede/timeout),
        // não uma resposta HTTP com status. Cold start do backend
        // serverless / 5xx se comportariam igual (ver `http-client.ts`:
        // sem `catch` em volta do `fetch`, o erro propaga cru, não vira
        // `ApiError`).
        return refreshCallCount === 1
          ? Promise.resolve(jsonResponse({ accessToken: 'access-token-1', expiresIn: 900 }))
          : Promise.reject(new TypeError('Failed to fetch'));
      }
      if (href === `${API_URL}/business/action`) {
        // Qualquer ação autenticada comum — sempre 401 aqui só pra forçar
        // outro refresh (simula o access token ter expirado no meio do uso).
        return Promise.resolve(
          jsonResponse(
            {
              statusCode: 401,
              message: 'Não autenticado.',
              timestamp: '',
              path: '/business/action',
            },
            401,
          ),
        );
      }
      return Promise.reject(new Error(`fetch não mockado para ${href}`));
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useSession(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('authenticated'));

    // Ação de negócio comum (ex.: clicar num botão) toma 401 -> tenta
    // renovar -> a renovação falha por motivo transitório. Sem a correção,
    // isso derrubava a sessão do mesmo jeito que um refresh token realmente
    // inválido — exatamente o bug relatado ("às vezes, ao clicar numa ação
    // ou navegar, meu login é anulado").
    await act(async () => {
      await httpClient.get('/business/action').catch(() => undefined);
    });

    expect(result.current.status).toBe('authenticated');
    expect(result.current.user).toEqual(sessionUser);
  });
});
