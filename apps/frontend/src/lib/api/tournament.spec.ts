import { tournamentApi } from './tournament';

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

describe('api/tournament', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = API_URL;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.resetAllMocks();
  });

  it('listTournaments faz GET em /tournaments', async () => {
    mockJsonResponse({ items: [], nextCursor: null });
    await tournamentApi.listTournaments();
    expect(lastCall()[0]).toBe(`${API_URL}/tournaments`);
  });

  it('createTournament faz POST em /tournaments com o corpo informado', async () => {
    mockJsonResponse({ id: 'trn-1' });
    const input = {
      name: 'Sunday Major',
      buyIn: '90.00',
      fee: '10.00',
      startingStack: 10000,
      maxPlayers: 9,
      startsAt: '2026-09-01T20:00:00.000Z',
      prizes: [{ position: 1, percentage: '100.00' }],
    };
    await tournamentApi.createTournament(input);
    const [url, init] = lastCall();
    expect(url).toBe(`${API_URL}/tournaments`);
    expect(init.body).toBe(JSON.stringify(input));
  });

  it('getTournament faz GET em /tournaments/:id', async () => {
    mockJsonResponse({ id: 'trn-1' });
    await tournamentApi.getTournament('trn-1');
    expect(lastCall()[0]).toBe(`${API_URL}/tournaments/trn-1`);
  });

  it('registerEntry envia o header Idempotency-Key sem corpo', async () => {
    mockJsonResponse({ id: 'entry-1' });
    await tournamentApi.registerEntry('trn-1', 'idem-1');
    const [url, init] = lastCall();
    expect(url).toBe(`${API_URL}/tournaments/trn-1/register`);
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('idem-1');
  });

  it('eliminateEntry faz POST em .../eliminate com o corpo informado', async () => {
    mockJsonResponse({ id: 'entry-1' });
    await tournamentApi.eliminateEntry('trn-1', 'entry-1', { finalPosition: 3 });
    const [url, init] = lastCall();
    expect(url).toBe(`${API_URL}/tournaments/trn-1/entries/entry-1/eliminate`);
    expect(init.body).toBe(JSON.stringify({ finalPosition: 3 }));
  });

  it('finishTournament faz POST em .../finish sem corpo', async () => {
    mockJsonResponse({ id: 'trn-1', status: 'FINISHED' });
    await tournamentApi.finishTournament('trn-1');
    const [url, init] = lastCall();
    expect(url).toBe(`${API_URL}/tournaments/trn-1/finish`);
    expect(init.body).toBeUndefined();
  });
});
