import type { SessionUser } from '@poker-system/shared';
import { ApiError } from '../http-client';
import { authApi, login, logout, me, refresh, register } from './auth';

const API_URL = 'http://localhost:3001/api';
const originalFetch = global.fetch;

type FetchArgs = [string, RequestInit];

function mockJsonResponse(body: unknown, status = 200): void {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status,
    json: async () => body,
  }) as unknown as typeof fetch;
}

function mockErrorResponse(statusCode: number, message: string, path: string): void {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status: statusCode,
    json: async () => ({
      statusCode,
      message,
      timestamp: new Date().toISOString(),
      path,
    }),
  }) as unknown as typeof fetch;
}

function lastCall(): FetchArgs {
  return (global.fetch as jest.Mock).mock.calls[0] as FetchArgs;
}

const sessionUser: SessionUser = {
  id: 'usr_1',
  email: 'player@poker.dev',
  name: 'Player One',
};

const tokens = { accessToken: 'jwt.access.token', expiresIn: 900 };

describe('api/auth', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = API_URL;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.resetAllMocks();
  });

  describe('register', () => {
    it('faz POST em /auth/register com o corpo informado e retorna o SessionUser', async () => {
      mockJsonResponse(sessionUser, 201);

      const result = await register({
        email: 'player@poker.dev',
        password: 'S3nh@Forte',
        name: 'Player One',
        document: '12345678901',
      });

      const [url, init] = lastCall();
      expect(url).toBe(`${API_URL}/auth/register`);
      expect(init.method).toBe('POST');
      expect(init.body).toBe(
        JSON.stringify({
          email: 'player@poker.dev',
          password: 'S3nh@Forte',
          name: 'Player One',
          document: '12345678901',
        }),
      );
      expect(result).toEqual(sessionUser);
    });

    it('converte 409 (e-mail já cadastrado) em ApiError com o statusCode correto', async () => {
      mockErrorResponse(409, 'E-mail já cadastrado.', '/api/auth/register');

      const error = await register({
        email: 'player@poker.dev',
        password: 'S3nh@Forte',
        name: 'Player One',
      }).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ statusCode: 409, message: 'E-mail já cadastrado.' });
    });
  });

  describe('login', () => {
    it('faz POST em /auth/login e retorna os tokens', async () => {
      mockJsonResponse(tokens);

      const result = await login({ email: 'player@poker.dev', password: 'S3nh@Forte' });

      const [url, init] = lastCall();
      expect(url).toBe(`${API_URL}/auth/login`);
      expect(init.method).toBe('POST');
      expect(init.body).toBe(JSON.stringify({ email: 'player@poker.dev', password: 'S3nh@Forte' }));
      expect(result).toEqual(tokens);
    });

    it('converte 401 (credenciais inválidas) em ApiError com o statusCode correto', async () => {
      mockErrorResponse(401, 'Credenciais inválidas.', '/api/auth/login');

      const error = await login({ email: 'player@poker.dev', password: 'errada' }).catch(
        (caught: unknown) => caught,
      );

      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ statusCode: 401, message: 'Credenciais inválidas.' });
    });
  });

  describe('refresh', () => {
    it('faz POST em /auth/refresh sem corpo (a credencial é o cookie httpOnly)', async () => {
      mockJsonResponse(tokens);

      const result = await refresh();

      const [url, init] = lastCall();
      expect(url).toBe(`${API_URL}/auth/refresh`);
      expect(init.method).toBe('POST');
      expect(init.body).toBeUndefined();
      expect(result).toEqual(tokens);
    });

    it('converte 401 (refresh token expirado) em ApiError', async () => {
      mockErrorResponse(401, 'Sessão expirada.', '/api/auth/refresh');

      const error = await refresh().catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ statusCode: 401 });
    });
  });

  describe('logout', () => {
    it('faz POST em /auth/logout sem corpo e resolve para undefined em 204', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: async () => {
          throw new Error('não deveria ser chamado');
        },
      }) as unknown as typeof fetch;

      const result = await logout();

      const [url, init] = lastCall();
      expect(url).toBe(`${API_URL}/auth/logout`);
      expect(init.method).toBe('POST');
      expect(init.body).toBeUndefined();
      expect(result).toBeUndefined();
    });
  });

  describe('me', () => {
    it('faz GET em /auth/me e retorna o SessionUser tipado', async () => {
      mockJsonResponse(sessionUser);

      const result = await me();

      const [url, init] = lastCall();
      expect(url).toBe(`${API_URL}/auth/me`);
      expect(init.method).toBe('GET');
      expect(result.id).toBe('usr_1');
      expect(result.email).toBe('player@poker.dev');
      expect(result.name).toBe('Player One');
    });

    it('converte 401 (sem sessão) em ApiError', async () => {
      mockErrorResponse(401, 'Não autenticado.', '/api/auth/me');

      const error = await me().catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ statusCode: 401 });
    });
  });

  describe("credentials: 'include'", () => {
    // O refresh token vive em cookie httpOnly; sem `credentials: 'include'`
    // o browser não o envia cross-origin e a sessão nunca se sustentaria.
    const cases: Array<[string, () => Promise<unknown>]> = [
      ['register', () => register({ email: 'a@b.dev', password: 'S3nh@Forte', name: 'A' })],
      ['login', () => login({ email: 'a@b.dev', password: 'S3nh@Forte' })],
      ['refresh', () => refresh()],
      ['logout', () => logout()],
      ['me', () => me()],
    ];

    it.each(cases)('%s envia credentials: include para o fetch', async (_name, call) => {
      mockJsonResponse({});

      await call();

      const [, init] = lastCall();
      expect(init.credentials).toBe('include');
    });
  });

  it('não persiste nenhum token em localStorage/sessionStorage', async () => {
    mockJsonResponse(tokens);
    const localSpy = jest.spyOn(Storage.prototype, 'setItem');

    await login({ email: 'player@poker.dev', password: 'S3nh@Forte' });
    await refresh();

    expect(localSpy).not.toHaveBeenCalled();
    localSpy.mockRestore();
  });

  it('expõe o namespace authApi com todas as operações', () => {
    expect(authApi).toEqual({ register, login, refresh, logout, me });
  });
});
