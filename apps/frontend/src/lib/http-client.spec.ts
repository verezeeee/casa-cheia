import { ApiError, httpClient } from './http-client';

const originalFetch = global.fetch;

describe('httpClient', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = 'http://localhost:3001/api';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.resetAllMocks();
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
});
