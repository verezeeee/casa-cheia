import { HttpService } from '@nestjs/axios';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AbacatePayClient } from './abacatepay.client';
import { AbacatePayModule } from './abacatepay.module';

describe('AbacatePayModule', () => {
  beforeEach(() => {
    // Silencia o aviso de "API key ausente" no cenário de defaults.
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const buildModule = (config: unknown) =>
    Test.createTestingModule({ imports: [AbacatePayModule] })
      .overrideProvider(ConfigService)
      .useValue({ get: jest.fn().mockReturnValue(config) })
      .compile();

  it('provê o AbacatePayClient com o HttpService configurado pelo ConfigService', async () => {
    const moduleRef = await buildModule({
      apiKey: 'chave-de-teste-12345',
      baseUrl: 'https://sandbox.abacatepay.test/v1',
      timeoutMs: 7_000,
    });

    const client = moduleRef.get(AbacatePayClient);
    const httpService = moduleRef.get(HttpService);

    expect(client).toBeInstanceOf(AbacatePayClient);
    expect(httpService.axiosRef.defaults.baseURL).toBe(
      'https://sandbox.abacatepay.test/v1',
    );
    expect(httpService.axiosRef.defaults.timeout).toBe(7_000);

    // A credencial NUNCA fica pendurada nos defaults do axios: ela é
    // montada por requisição dentro do client.
    expect(
      JSON.stringify(httpService.axiosRef.defaults.headers ?? {}),
    ).not.toContain('chave-de-teste-12345');

    await moduleRef.close();
  });

  it('cai nos defaults quando o namespace de config está ausente', async () => {
    const moduleRef = await buildModule(undefined);
    const httpService = moduleRef.get(HttpService);

    expect(httpService.axiosRef.defaults.baseURL).toBe(
      'https://api.abacatepay.com/v1',
    );
    expect(httpService.axiosRef.defaults.timeout).toBe(10_000);

    await moduleRef.close();
  });
});
