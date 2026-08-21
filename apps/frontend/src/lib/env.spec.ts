import { getApiUrl } from './env';

describe('getApiUrl', () => {
  const ORIGINAL_ENV = process.env.NEXT_PUBLIC_API_URL;

  afterEach(() => {
    process.env.NEXT_PUBLIC_API_URL = ORIGINAL_ENV;
  });

  it('retorna a URL configurada sem barra final', () => {
    process.env.NEXT_PUBLIC_API_URL = 'http://localhost:3001/api/';

    expect(getApiUrl()).toBe('http://localhost:3001/api');
  });

  it('lança erro explícito quando NEXT_PUBLIC_API_URL não está definida', () => {
    delete process.env.NEXT_PUBLIC_API_URL;

    expect(() => getApiUrl()).toThrow(/NEXT_PUBLIC_API_URL/);
  });
});
