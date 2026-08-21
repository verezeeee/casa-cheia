import { tableApi } from './table';

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

describe('api/table', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = API_URL;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.resetAllMocks();
  });

  it('listTables faz GET em /tables', async () => {
    mockJsonResponse({ items: [], nextCursor: null });
    await tableApi.listTables();
    expect(lastCall()[0]).toBe(`${API_URL}/tables`);
  });

  it('createTable faz POST em /tables com o corpo informado', async () => {
    mockJsonResponse({ id: 'table-1' });
    const input = {
      name: 'Mesa',
      type: 'CASH_GAME' as const,
      smallBlind: '1.00',
      bigBlind: '2.00',
      minBuyIn: '40.00',
      maxBuyIn: '200.00',
      maxSeats: 6,
    };
    await tableApi.createTable(input);
    const [url, init] = lastCall();
    expect(url).toBe(`${API_URL}/tables`);
    expect(init.body).toBe(JSON.stringify(input));
  });

  it('getSeats faz GET em /tables/:id/seats', async () => {
    mockJsonResponse([]);
    await tableApi.getSeats('table-1');
    expect(lastCall()[0]).toBe(`${API_URL}/tables/table-1/seats`);
  });

  it('sitAtTable envia o header Idempotency-Key', async () => {
    mockJsonResponse({ seatNumber: 1 });
    await tableApi.sitAtTable('table-1', { seatNumber: 1, buyInAmount: '50.00' }, 'idem-1');
    const [url, init] = lastCall();
    expect(url).toBe(`${API_URL}/tables/table-1/sit`);
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('idem-1');
  });

  it('cashOut faz POST sem corpo com o header Idempotency-Key', async () => {
    mockJsonResponse({ seatNumber: 1 });
    await tableApi.cashOut('table-1', 'session-1', 'idem-2');
    const [url, init] = lastCall();
    expect(url).toBe(`${API_URL}/tables/table-1/sessions/session-1/cash-out`);
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('idem-2');
  });

  it('recordMovement faz POST em .../movements', async () => {
    mockJsonResponse({ seatNumber: 1 });
    await tableApi.recordMovement('table-1', 'session-1', {
      amount: '10.00',
      reason: 'HAND_RESULT',
    });
    expect(lastCall()[0]).toBe(`${API_URL}/tables/table-1/sessions/session-1/movements`);
  });
});
