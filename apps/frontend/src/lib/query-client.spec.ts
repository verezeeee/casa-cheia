import { createQueryClient } from './query-client';

describe('createQueryClient', () => {
  it('cria um QueryClient com retry desabilitado para mutations e refetchOnWindowFocus desligado', () => {
    const client = createQueryClient();
    const defaults = client.getDefaultOptions();

    expect(defaults.queries?.refetchOnWindowFocus).toBe(false);
    expect(defaults.mutations?.retry).toBe(0);
  });
});
