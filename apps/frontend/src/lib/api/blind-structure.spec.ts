import { blindStructureApi } from './blind-structure';
import { setCurrentClubeId } from './club-context';
import type { CreateBlindStructureRequest } from './types';

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

const PRESET: CreateBlindStructureRequest = {
  name: 'Turbo 20min',
  levels: [{ levelNumber: 1, smallBlind: 25, bigBlind: 50, durationSeconds: 1200 }],
};

describe('api/blind-structure', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = API_URL;
    setCurrentClubeId('clube-1');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    setCurrentClubeId(null);
    jest.resetAllMocks();
  });

  it('createBlindStructure faz POST em /blind-structures com o corpo informado', async () => {
    mockJsonResponse({ id: 'bs-1' });
    await blindStructureApi.createBlindStructure(PRESET);
    const [url, init] = lastCall();
    expect(url).toBe(`${API_URL}/clubes/clube-1/blind-structures`);
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify(PRESET));
  });

  it('listBlindStructures faz GET em /blind-structures', async () => {
    mockJsonResponse([]);
    await blindStructureApi.listBlindStructures();
    const [url, init] = lastCall();
    expect(url).toBe(`${API_URL}/clubes/clube-1/blind-structures`);
    expect(init.method).toBe('GET');
  });

  it('getBlindStructure faz GET em /blind-structures/:id', async () => {
    mockJsonResponse({ id: 'bs-1' });
    await blindStructureApi.getBlindStructure('bs-1');
    expect(lastCall()[0]).toBe(`${API_URL}/clubes/clube-1/blind-structures/bs-1`);
  });

  it('updateBlindStructure faz PUT (substitui a grade inteira)', async () => {
    mockJsonResponse({ id: 'bs-1' });
    await blindStructureApi.updateBlindStructure('bs-1', PRESET);
    const [url, init] = lastCall();
    expect(url).toBe(`${API_URL}/clubes/clube-1/blind-structures/bs-1`);
    expect(init.method).toBe('PUT');
    expect(init.body).toBe(JSON.stringify(PRESET));
  });

  it('deleteBlindStructure faz DELETE e tolera o 204 sem corpo', async () => {
    mockJsonResponse(undefined, 204);
    await expect(blindStructureApi.deleteBlindStructure('bs-1')).resolves.toBeUndefined();
    const [url, init] = lastCall();
    expect(url).toBe(`${API_URL}/clubes/clube-1/blind-structures/bs-1`);
    expect(init.method).toBe('DELETE');
  });
});
