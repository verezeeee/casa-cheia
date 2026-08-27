import { setAccessToken } from '../http-client';
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

  it('redraw faz POST em .../redraw sem corpo', async () => {
    mockJsonResponse({ tournamentId: 'trn-1', tables: [] });
    await tournamentApi.redraw('trn-1');
    const [url, init] = lastCall();
    expect(url).toBe(`${API_URL}/tournaments/trn-1/redraw`);
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
  });

  it.each([
    ['startClock', 'start'],
    ['pauseClock', 'pause'],
    ['resumeClock', 'resume'],
    ['nextLevel', 'next'],
    ['previousLevel', 'previous'],
  ] as const)('%s faz POST em /tournaments/:id/clock/%s', async (fn, action) => {
    mockJsonResponse({ clockStatus: 'RUNNING' });
    await tournamentApi[fn]('trn-1');
    const [url, init] = lastCall();
    expect(url).toBe(`${API_URL}/tournaments/trn-1/clock/${action}`);
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
  });

  it('updateBlindLevel faz PATCH em /tournaments/:id/blind-levels/:levelNumber', async () => {
    mockJsonResponse({ clockStatus: 'RUNNING' });
    await tournamentApi.updateBlindLevel('trn-1', 4, { durationSeconds: 900 });
    const [url, init] = lastCall();
    expect(url).toBe(`${API_URL}/tournaments/trn-1/blind-levels/4`);
    expect(init.method).toBe('PATCH');
    expect(init.body).toBe(JSON.stringify({ durationSeconds: 900 }));
  });

  describe('rotas públicas de display (TV sem login)', () => {
    // A TV do salão não tem sessão: `httpClient` só anexa `Authorization`
    // quando há token em memória, então a chamada precisa sair mesmo assim.
    beforeEach(() => setAccessToken(null));
    afterEach(() => setAccessToken(null));

    it('getClock faz GET em /display/tournaments/:id/clock sem Authorization', async () => {
      mockJsonResponse({ clockStatus: 'RUNNING', serverTime: '2026-08-22T20:00:00.000Z' });
      await tournamentApi.getClock('trn-1');
      const [url, init] = lastCall();
      expect(url).toBe(`${API_URL}/display/tournaments/trn-1/clock`);
      expect(init.method).toBe('GET');
      expect(init.headers as Record<string, string>).not.toHaveProperty('Authorization');
    });

    it('getTableMap faz GET em /display/tournaments/:id/tables sem Authorization', async () => {
      mockJsonResponse({ tournamentId: 'trn-1', tables: [] });
      await tournamentApi.getTableMap('trn-1');
      const [url, init] = lastCall();
      expect(url).toBe(`${API_URL}/display/tournaments/trn-1/tables`);
      expect(init.method).toBe('GET');
      expect(init.headers as Record<string, string>).not.toHaveProperty('Authorization');
    });

    it('anexa Authorization quando o staff está logado (backend ignora)', async () => {
      setAccessToken('token-staff');
      mockJsonResponse({ tournamentId: 'trn-1', tables: [] });
      await tournamentApi.getTableMap('trn-1');
      expect((lastCall()[1].headers as Record<string, string>).Authorization).toBe(
        'Bearer token-staff',
      );
    });
  });
});
