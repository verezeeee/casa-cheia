import { ApiError, httpClient, setAccessToken, setUnauthorizedHandler } from './http-client';

const originalFetch = global.fetch;

describe('httpClient', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = 'http://localhost:3001/api';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.resetAllMocks();
    setAccessToken(null);
    setUnauthorizedHandler(null);
  });

  it('faz GET contra NEXT_PUBLIC_API_URL + path e retorna o JSON parseado', async () => {
    const mockResponse = { status: 'ok' };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    }) as unknown as typeof fetch;

    const result = await httpClient.get('/health');

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3001/api/health',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(result).toEqual(mockResponse);
  });

  it('serializa o body em POST e envia Content-Type json', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: '1' }),
    }) as unknown as typeof fetch;

    await httpClient.post('/wallets', { amount: 100 });

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ amount: 100 }));
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('lança ApiError com o payload padronizado quando a resposta não é ok', async () => {
    const errorPayload = {
      statusCode: 400,
      message: 'saldo insuficiente',
      timestamp: new Date().toISOString(),
      path: '/api/wallets/withdraw',
    };
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => errorPayload,
    }) as unknown as typeof fetch;

    await expect(httpClient.get('/wallets/withdraw')).rejects.toBeInstanceOf(ApiError);
    await expect(httpClient.get('/wallets/withdraw')).rejects.toMatchObject({
      statusCode: 400,
      message: 'saldo insuficiente',
    });
  });

  it('retorna undefined para respostas 204 No Content', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => {
        throw new Error('não deveria ser chamado');
      },
    }) as unknown as typeof fetch;

    const result = await httpClient.delete('/sessions/1');
    expect(result).toBeUndefined();
  });

  describe('access token e retentativa em 401', () => {
    it('anexa Authorization: Bearer quando há access token em memória', async () => {
      setAccessToken('jwt.access.token');
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
      }) as unknown as typeof fetch;

      await httpClient.get('/wallet/balance');

      const [, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(init.headers.Authorization).toBe('Bearer jwt.access.token');
    });

    it('não anexa Authorization quando não há sessão', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
      }) as unknown as typeof fetch;

      await httpClient.get('/health');

      const [, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(init.headers.Authorization).toBeUndefined();
    });

    it('em 401, chama o handler de sessão expirada e reexecuta UMA vez com o token renovado', async () => {
      setAccessToken('token-vencido');
      const handler = jest.fn().mockImplementation(async () => {
        setAccessToken('token-novo');
        return 'token-novo';
      });
      setUnauthorizedHandler(handler);

      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ balance: '0.00' }),
        }) as unknown as typeof fetch;

      const result = await httpClient.get('/wallet/balance');

      expect(handler).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledTimes(2);
      const [, secondInit] = (global.fetch as jest.Mock).mock.calls[1];
      expect(secondInit.headers.Authorization).toBe('Bearer token-novo');
      expect(result).toEqual({ balance: '0.00' });
    });

    it('quando o handler não consegue renovar (retorna null), propaga o 401 sem loop', async () => {
      setAccessToken('token-vencido');
      const handler = jest.fn().mockResolvedValue(null);
      setUnauthorizedHandler(handler);

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ statusCode: 401, message: 'expirado', timestamp: '', path: '/x' }),
      }) as unknown as typeof fetch;

      await expect(httpClient.get('/wallet/balance')).rejects.toBeInstanceOf(ApiError);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('com skipAuthRetry, um 401 nunca chama o handler', async () => {
      setAccessToken('token-vencido');
      const handler = jest.fn();
      setUnauthorizedHandler(handler);

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ statusCode: 401, message: 'expirado', timestamp: '', path: '/x' }),
      }) as unknown as typeof fetch;

      await expect(
        httpClient.post('/auth/refresh', undefined, { skipAuthRetry: true }),
      ).rejects.toBeInstanceOf(ApiError);
      expect(handler).not.toHaveBeenCalled();
    });
  });
});
