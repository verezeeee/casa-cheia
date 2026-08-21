import { walletApi } from './wallet';

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

function lastCall(): FetchArgs {
  return (global.fetch as jest.Mock).mock.calls[0] as FetchArgs;
}

describe('api/wallet', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = API_URL;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.resetAllMocks();
  });

  it('getBalance faz GET em /wallet/balance', async () => {
    mockJsonResponse({ balance: '100.00', version: 2 });

    const result = await walletApi.getBalance();

    const [url, init] = lastCall();
    expect(url).toBe(`${API_URL}/wallet/balance`);
    expect(init.method).toBe('GET');
    expect(result).toEqual({ balance: '100.00', version: 2 });
  });

  it('getTransactions sem cursor não anexa query string', async () => {
    mockJsonResponse({ items: [], nextCursor: null });

    await walletApi.getTransactions();

    const [url] = lastCall();
    expect(url).toBe(`${API_URL}/wallet/transactions`);
  });

  it('getTransactions com cursor anexa ?cursor=... (URL-encoded)', async () => {
    mockJsonResponse({ items: [], nextCursor: null });

    await walletApi.getTransactions('a/b+c');

    const [url] = lastCall();
    expect(url).toBe(`${API_URL}/wallet/transactions?cursor=a%2Fb%2Bc`);
  });

  it('createDeposit envia o corpo e o header Idempotency-Key', async () => {
    mockJsonResponse({
      id: 'chg_1',
      amount: '50.00',
      status: 'PENDING',
      qrCodePayload: '000201',
      qrCodeImageUrl: null,
      expiresAt: '2026-01-01T00:00:00.000Z',
    });

    await walletApi.createDeposit({ amount: '50.00' }, 'idem-key-1');

    const [url, init] = lastCall();
    expect(url).toBe(`${API_URL}/wallet/deposits`);
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ amount: '50.00' }));
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('idem-key-1');
  });

  it('requestWithdrawal envia o corpo e o header Idempotency-Key', async () => {
    mockJsonResponse({
      id: 'wdr_1',
      amount: '30.00',
      status: 'PROCESSING',
      pixKeyMasked: '***.com',
      failureReason: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    await walletApi.requestWithdrawal(
      { amount: '30.00', pixKey: 'a@b.com', pixKeyType: 'EMAIL' },
      'idem-key-2',
    );

    const [url, init] = lastCall();
    expect(url).toBe(`${API_URL}/wallet/withdrawals`);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('idem-key-2');
  });
});
