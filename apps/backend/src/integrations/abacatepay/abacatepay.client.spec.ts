import { HttpService } from '@nestjs/axios';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosError, AxiosHeaders } from 'axios';
import type { AxiosRequestConfig, AxiosResponse } from 'axios';
import { of, throwError } from 'rxjs';
import { inspect } from 'util';
import {
  ABACATEPAY_ENDPOINTS,
  AbacatePayClient,
  MAX_ATTEMPTS,
} from './abacatepay.client';
import {
  AbacatePayInvalidAmountError,
  AbacatePayRequestError,
  AbacatePayUnavailableError,
  AbacatePayUnexpectedResponseError,
} from './errors';
import type { AbacatePayConfig } from './types';

const API_KEY = 'abacatepay_live_SUPERSECRETKEY_9f8e7d6c';
const BASE_URL = 'https://sandbox.abacatepay.test/v1';
const PIX_KEY = 'jogador@exemplo.com';

interface LoggerCapture {
  /** Todos os argumentos passados a qualquer método do Logger. */
  args: unknown[];
  warn: jest.SpyInstance;
  error: jest.SpyInstance;
  debug: jest.SpyInstance;
}

const buildClient = (
  configOverrides: Partial<AbacatePayConfig> = {},
): {
  client: AbacatePayClient;
  request: jest.Mock;
  logger: LoggerCapture;
} => {
  const request = jest.fn();
  const httpService = { request } as unknown as HttpService;

  const config: AbacatePayConfig = {
    apiKey: API_KEY,
    baseUrl: BASE_URL,
    // Sem espera entre tentativas: o teste valida a POLÍTICA de retry,
    // não o backoff (que é tempo de parede puro).
    retryDelayMs: 0,
    timeoutMs: 5_000,
    ...configOverrides,
  };

  const configService = {
    get: jest.fn().mockReturnValue(config),
  } as unknown as ConfigService;

  const client = new AbacatePayClient(httpService, configService);

  const internalLogger = (client as unknown as { logger: Logger }).logger;
  const args: unknown[] = [];
  const capture = (...callArgs: unknown[]): undefined => {
    args.push(...callArgs);
    return undefined;
  };

  const logger: LoggerCapture = {
    args,
    warn: jest.spyOn(internalLogger, 'warn').mockImplementation(capture),
    error: jest.spyOn(internalLogger, 'error').mockImplementation(capture),
    debug: jest.spyOn(internalLogger, 'debug').mockImplementation(capture),
  };
  jest.spyOn(internalLogger, 'log').mockImplementation(capture);
  jest.spyOn(internalLogger, 'verbose').mockImplementation(capture);

  return { client, request, logger };
};

const okResponse = (data: unknown): AxiosResponse<unknown> => ({
  status: 200,
  statusText: 'OK',
  data,
  headers: {},
  config: { headers: new AxiosHeaders() },
});

/** Config de request "realista": carrega o header Authorization com a chave. */
const axiosConfigWithSecret = (): AxiosRequestConfig =>
  ({
    url: '/pixQrCode/create',
    method: 'POST',
    headers: new AxiosHeaders({ Authorization: `Bearer ${API_KEY}` }),
  }) as AxiosRequestConfig;

const httpErrorOf = (status: number, data: unknown = {}): AxiosError => {
  const config = axiosConfigWithSecret();

  return new AxiosError(
    `Request failed with status code ${status}`,
    status >= 500 ? 'ERR_BAD_RESPONSE' : 'ERR_BAD_REQUEST',
    config as never,
    {},
    {
      status,
      statusText: 'ERR',
      data,
      headers: {},
      config,
    } as unknown as AxiosResponse,
  );
};

const timeoutErrorOf = (): AxiosError =>
  new AxiosError(
    'timeout of 5000ms exceeded',
    'ECONNABORTED',
    axiosConfigWithSecret() as never,
    {},
  );

const networkErrorOf = (): AxiosError =>
  new AxiosError(
    'connect ECONNREFUSED 127.0.0.1:443',
    'ECONNREFUSED',
    axiosConfigWithSecret() as never,
    {},
  );

const CHARGE_PAYLOAD = {
  data: {
    id: 'pix_char_123',
    status: 'PENDING',
    amount: 12550,
    externalId: 'tx-local-1',
    brCode: '00020126580014BR.GOV.BCB.PIX',
    brCodeBase64: 'data:image/png;base64,AAAA',
    createdAt: '2026-08-16T12:00:00.000Z',
    expiresAt: '2026-08-16T12:30:00.000Z',
  },
  error: null,
};

const WITHDRAWAL_PAYLOAD = {
  data: {
    id: 'wd_789',
    status: 'PROCESSING',
    amount: 5000,
    externalId: 'tx-local-2',
    createdAt: '2026-08-16T12:00:00.000Z',
  },
  error: null,
};

/** Serialização profunda (inclui props não enumeráveis e `cause`). */
const deepSerialize = (value: unknown): string =>
  inspect(value, { depth: 10, showHidden: true, breakLength: Infinity });

const captureError = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
    throw new Error('A promise deveria ter rejeitado.');
  } catch (error) {
    return error;
  }
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe('AbacatePayClient', () => {
  describe('createPixCharge', () => {
    it('mapeia a resposta de sucesso para AbacatePayChargeResult', async () => {
      const { client, request } = buildClient();
      request.mockReturnValue(of(okResponse(CHARGE_PAYLOAD)));

      const result = await client.createPixCharge({
        amount: '125.50',
        externalReferenceId: 'tx-local-1',
        description: 'Depósito PIX',
      });

      expect(result).toEqual({
        externalId: 'pix_char_123',
        status: 'PENDING',
        rawStatus: 'PENDING',
        amount: '125.50',
        externalReferenceId: 'tx-local-1',
        brCode: '00020126580014BR.GOV.BCB.PIX',
        brCodeBase64: 'data:image/png;base64,AAAA',
        createdAt: '2026-08-16T12:00:00.000Z',
        expiresAt: '2026-08-16T12:30:00.000Z',
        paidAt: undefined,
      });
      expect(request).toHaveBeenCalledTimes(1);
    });

    it('envia o valor em centavos inteiros, com baseURL, timeout e Authorization vindos da config', async () => {
      const { client, request } = buildClient();
      request.mockReturnValue(of(okResponse(CHARGE_PAYLOAD)));

      await client.createPixCharge({
        amount: '125.50',
        externalReferenceId: 'tx-local-1',
      });

      const sentConfig = request.mock.calls[0][0] as AxiosRequestConfig;
      expect(sentConfig.method).toBe('POST');
      expect(sentConfig.url).toBe(ABACATEPAY_ENDPOINTS.createPixCharge);
      expect(sentConfig.baseURL).toBe(BASE_URL);
      expect(sentConfig.timeout).toBe(5_000);
      expect(sentConfig.data).toMatchObject({
        amount: 12550,
        externalId: 'tx-local-1',
      });
      expect((sentConfig.headers as Record<string, string>).Authorization).toBe(
        `Bearer ${API_KEY}`,
      );
    });

    it('rejeita valor que não seja string decimal ANTES de qualquer I/O', async () => {
      const { client, request } = buildClient();

      await expect(
        client.createPixCharge({
          amount: 125.5 as unknown as string,
          externalReferenceId: 'tx-local-1',
        }),
      ).rejects.toBeInstanceOf(AbacatePayInvalidAmountError);
      expect(request).not.toHaveBeenCalled();
    });

    it('lança AbacatePayRequestError em 4xx SEM retry (exatamente 1 chamada HTTP)', async () => {
      const { client, request } = buildClient();
      request.mockReturnValue(
        throwError(() =>
          httpErrorOf(400, {
            error: 'invalid_amount',
            message: 'amount < min',
          }),
        ),
      );

      const error = (await captureError(
        client.createPixCharge({
          amount: '125.50',
          externalReferenceId: 'tx-local-1',
        }),
      )) as AbacatePayRequestError;

      expect(error).toBeInstanceOf(AbacatePayRequestError);
      expect(error.status).toBe(400);
      expect(error.operation).toBe('createPixCharge');
      expect(error.responseBody).toEqual({
        error: 'invalid_amount',
        message: 'amount < min',
      });
      expect(request).toHaveBeenCalledTimes(1);
    });

    it('não retenta nem em 429 (rate limit é decisão do chamador)', async () => {
      const { client, request } = buildClient();
      request.mockReturnValue(throwError(() => httpErrorOf(429)));

      await expect(
        client.createPixCharge({
          amount: '10.00',
          externalReferenceId: 'tx-local-1',
        }),
      ).rejects.toBeInstanceOf(AbacatePayRequestError);
      expect(request).toHaveBeenCalledTimes(1);
    });

    it('lança AbacatePayUnavailableError em 5xx APÓS exatamente 1 retry (2 chamadas HTTP)', async () => {
      const { client, request } = buildClient();
      request.mockReturnValue(
        throwError(() => httpErrorOf(503, 'unavailable')),
      );

      const error = (await captureError(
        client.createPixCharge({
          amount: '125.50',
          externalReferenceId: 'tx-local-1',
        }),
      )) as AbacatePayUnavailableError;

      expect(error).toBeInstanceOf(AbacatePayUnavailableError);
      expect(error.status).toBe(503);
      expect(error.attempts).toBe(MAX_ATTEMPTS);
      expect(request).toHaveBeenCalledTimes(2);
    });

    it('trata timeout como 5xx: 1 retry e depois erro de domínio', async () => {
      const { client, request } = buildClient();
      request.mockReturnValue(throwError(() => timeoutErrorOf()));

      const error = (await captureError(
        client.createPixCharge({
          amount: '125.50',
          externalReferenceId: 'tx-local-1',
        }),
      )) as AbacatePayUnavailableError;

      expect(error).toBeInstanceOf(AbacatePayUnavailableError);
      expect(error.code).toBe('ECONNABORTED');
      expect(error.status).toBeUndefined();
      expect(request).toHaveBeenCalledTimes(2);
    });

    it('retenta erro de rede e devolve o resultado quando a 2ª tentativa tem sucesso', async () => {
      const { client, request } = buildClient();
      request
        .mockReturnValueOnce(throwError(() => networkErrorOf()))
        .mockReturnValueOnce(of(okResponse(CHARGE_PAYLOAD)));

      const result = await client.createPixCharge({
        amount: '125.50',
        externalReferenceId: 'tx-local-1',
      });

      expect(result.externalId).toBe('pix_char_123');
      expect(request).toHaveBeenCalledTimes(2);
    });

    it('aguarda o backoff configurado antes do retry', async () => {
      const { client, request } = buildClient({ retryDelayMs: 5 });
      request
        .mockReturnValueOnce(throwError(() => httpErrorOf(500)))
        .mockReturnValueOnce(of(okResponse(CHARGE_PAYLOAD)));

      const startedAt = Date.now();
      await client.createPixCharge({
        amount: '125.50',
        externalReferenceId: 'tx-local-1',
      });

      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(4);
      expect(request).toHaveBeenCalledTimes(2);
    });

    it('preenche createdAt quando o gateway omite o timestamp', async () => {
      const { client, request } = buildClient();
      const semCreatedAt: Record<string, unknown> = { ...CHARGE_PAYLOAD.data };
      delete semCreatedAt.createdAt;
      request.mockReturnValue(
        of(okResponse({ data: semCreatedAt, error: null })),
      );

      const result = await client.createPixCharge({
        amount: '125.50',
        externalReferenceId: 'tx-local-1',
      });

      expect(new Date(result.createdAt).toString()).not.toBe('Invalid Date');
    });

    it('não retenta erro não-axios (defeito determinístico) e o converte em erro de domínio', async () => {
      const { client, request } = buildClient();
      request.mockReturnValue(throwError(() => new TypeError('boom')));

      const error = (await captureError(
        client.createPixCharge({
          amount: '125.50',
          externalReferenceId: 'tx-local-1',
        }),
      )) as AbacatePayUnavailableError;

      expect(error).toBeInstanceOf(AbacatePayUnavailableError);
      expect(error.attempts).toBe(1);
      expect(request).toHaveBeenCalledTimes(1);
    });

    it('lança AbacatePayUnexpectedResponseError quando faltam campos obrigatórios', async () => {
      const { client, request } = buildClient();
      request.mockReturnValue(
        of(okResponse({ data: { id: 'pix_char_123' }, error: null })),
      );

      const error = (await captureError(
        client.createPixCharge({
          amount: '125.50',
          externalReferenceId: 'tx-local-1',
        }),
      )) as AbacatePayUnexpectedResponseError;

      expect(error).toBeInstanceOf(AbacatePayUnexpectedResponseError);
      expect(error.responseBody).toEqual({ id: 'pix_char_123' });
      expect(request).toHaveBeenCalledTimes(1);
    });

    it('lança AbacatePayUnexpectedResponseError quando o corpo não é um objeto JSON', async () => {
      const { client, request } = buildClient();
      request.mockReturnValue(of(okResponse('<html>maintenance</html>')));

      await expect(
        client.createPixCharge({
          amount: '125.50',
          externalReferenceId: 'tx-local-1',
        }),
      ).rejects.toBeInstanceOf(AbacatePayUnexpectedResponseError);
    });

    it('lança AbacatePayUnexpectedResponseError quando o envelope 2xx traz `error` preenchido', async () => {
      const { client, request } = buildClient();
      request.mockReturnValue(
        of(okResponse({ data: null, error: 'invalid_api_version' })),
      );

      const error = (await captureError(
        client.createPixCharge({
          amount: '10.00',
          externalReferenceId: 'tx-local-1',
        }),
      )) as AbacatePayUnexpectedResponseError;

      expect(error).toBeInstanceOf(AbacatePayUnexpectedResponseError);
      expect(error.responseBody).toBe('invalid_api_version');
    });

    it('normaliza status desconhecido como UNKNOWN preservando rawStatus', async () => {
      const { client, request, logger } = buildClient();
      request.mockReturnValue(
        of(
          okResponse({
            data: { ...CHARGE_PAYLOAD.data, status: 'SOMETHING_NEW' },
            error: null,
          }),
        ),
      );

      const result = await client.createPixCharge({
        amount: '125.50',
        externalReferenceId: 'tx-local-1',
      });

      expect(result.status).toBe('UNKNOWN');
      expect(result.rawStatus).toBe('SOMETHING_NEW');
      expect(logger.warn).toHaveBeenCalled();
    });

    it('aceita a resposta sem envelope `data` (tolerância a variação de rota)', async () => {
      const { client, request } = buildClient();
      request.mockReturnValue(of(okResponse({ ...CHARGE_PAYLOAD.data })));

      const result = await client.createPixCharge({
        amount: '125.50',
        externalReferenceId: 'tx-local-1',
      });

      expect(result.externalId).toBe('pix_char_123');
      expect(result.amount).toBe('125.50');
    });
  });

  describe('getPixCharge', () => {
    it('consulta a cobrança por id e mapeia o resultado (caminho feliz)', async () => {
      const { client, request } = buildClient();
      request.mockReturnValue(
        of(
          okResponse({
            data: {
              ...CHARGE_PAYLOAD.data,
              status: 'PAID',
              paidAt: '2026-08-16T12:10:00.000Z',
            },
            error: null,
          }),
        ),
      );

      const result = await client.getPixCharge('pix_char_123');

      const sentConfig = request.mock.calls[0][0] as AxiosRequestConfig;
      expect(sentConfig.method).toBe('GET');
      expect(sentConfig.url).toBe(ABACATEPAY_ENDPOINTS.getPixCharge);
      expect(sentConfig.params).toEqual({ id: 'pix_char_123' });
      expect(result.status).toBe('PAID');
      expect(result.paidAt).toBe('2026-08-16T12:10:00.000Z');
    });

    it('lança AbacatePayRequestError sem retry quando a cobrança não existe (404)', async () => {
      const { client, request } = buildClient();
      request.mockReturnValue(
        throwError(() => httpErrorOf(404, { message: 'not found' })),
      );

      const error = (await captureError(
        client.getPixCharge('pix_inexistente'),
      )) as AbacatePayRequestError;

      expect(error).toBeInstanceOf(AbacatePayRequestError);
      expect(error.status).toBe(404);
      expect(error.operation).toBe('getPixCharge');
      expect(request).toHaveBeenCalledTimes(1);
    });

    it('lança AbacatePayUnavailableError após 1 retry em 500', async () => {
      const { client, request } = buildClient();
      request.mockReturnValue(throwError(() => httpErrorOf(500)));

      await expect(client.getPixCharge('pix_char_123')).rejects.toBeInstanceOf(
        AbacatePayUnavailableError,
      );
      expect(request).toHaveBeenCalledTimes(2);
    });

    it('aceita `amount` serializado como string de centavos pelo gateway', async () => {
      const { client, request } = buildClient();
      request.mockReturnValue(
        of(
          okResponse({
            data: { ...CHARGE_PAYLOAD.data, amount: ' 12550 ' },
            error: null,
          }),
        ),
      );

      const result = await client.getPixCharge('pix_char_123');

      expect(result.amount).toBe('125.50');
    });
  });

  describe('requestPixWithdrawal', () => {
    it('normaliza status de saque desconhecido como UNKNOWN', async () => {
      const { client, request, logger } = buildClient();
      request.mockReturnValue(
        of(
          okResponse({
            data: { ...WITHDRAWAL_PAYLOAD.data, status: 'ESTORNANDO' },
            error: null,
          }),
        ),
      );

      const result = await client.requestPixWithdrawal({
        amount: '50.00',
        pixKey: PIX_KEY,
        pixKeyType: 'EMAIL',
        externalReferenceId: 'tx-local-2',
      });

      expect(result.status).toBe('UNKNOWN');
      expect(result.rawStatus).toBe('ESTORNANDO');
      expect(logger.warn).toHaveBeenCalled();
    });

    it('lança AbacatePayUnexpectedResponseError quando o saque volta sem id', async () => {
      const { client, request } = buildClient();
      request.mockReturnValue(
        of(okResponse({ data: { status: 'PROCESSING' }, error: null })),
      );

      await expect(
        client.requestPixWithdrawal({
          amount: '50.00',
          pixKey: PIX_KEY,
          pixKeyType: 'EMAIL',
          externalReferenceId: 'tx-local-2',
        }),
      ).rejects.toBeInstanceOf(AbacatePayUnexpectedResponseError);
    });

    it('solicita o saque e mapeia o resultado (caminho feliz)', async () => {
      const { client, request } = buildClient();
      request.mockReturnValue(of(okResponse(WITHDRAWAL_PAYLOAD)));

      const result = await client.requestPixWithdrawal({
        amount: '50.00',
        pixKey: PIX_KEY,
        pixKeyType: 'EMAIL',
        externalReferenceId: 'tx-local-2',
      });

      const sentConfig = request.mock.calls[0][0] as AxiosRequestConfig;
      expect(sentConfig.method).toBe('POST');
      expect(sentConfig.url).toBe(ABACATEPAY_ENDPOINTS.requestPixWithdrawal);
      expect(sentConfig.data).toMatchObject({
        amount: 5000,
        pixKey: PIX_KEY,
        pixKeyType: 'EMAIL',
        externalId: 'tx-local-2',
      });

      expect(result).toEqual({
        externalId: 'wd_789',
        status: 'PROCESSING',
        rawStatus: 'PROCESSING',
        amount: '50.00',
        externalReferenceId: 'tx-local-2',
        createdAt: '2026-08-16T12:00:00.000Z',
        completedAt: undefined,
      });
      // A chave PIX é dado pessoal: nunca volta no resultado.
      expect(deepSerialize(result)).not.toContain(PIX_KEY);
    });

    it('lança AbacatePayRequestError sem retry quando o gateway recusa o saque (422)', async () => {
      const { client, request } = buildClient();
      request.mockReturnValue(
        throwError(() => httpErrorOf(422, { message: 'invalid pix key' })),
      );

      const error = (await captureError(
        client.requestPixWithdrawal({
          amount: '50.00',
          pixKey: PIX_KEY,
          pixKeyType: 'EMAIL',
          externalReferenceId: 'tx-local-2',
        }),
      )) as AbacatePayRequestError;

      expect(error).toBeInstanceOf(AbacatePayRequestError);
      expect(error.status).toBe(422);
      expect(request).toHaveBeenCalledTimes(1);
    });

    it('lança AbacatePayUnavailableError após 1 retry em 502', async () => {
      const { client, request } = buildClient();
      request.mockReturnValue(throwError(() => httpErrorOf(502)));

      await expect(
        client.requestPixWithdrawal({
          amount: '50.00',
          pixKey: PIX_KEY,
          pixKeyType: 'EMAIL',
          externalReferenceId: 'tx-local-2',
        }),
      ).rejects.toBeInstanceOf(AbacatePayUnavailableError);
      expect(request).toHaveBeenCalledTimes(2);
    });

    it('não expõe a chave PIX em nenhum log, nem no caminho de erro', async () => {
      const { client, request, logger } = buildClient();
      request.mockReturnValue(throwError(() => httpErrorOf(422)));

      const error = await captureError(
        client.requestPixWithdrawal({
          amount: '50.00',
          pixKey: PIX_KEY,
          pixKeyType: 'EMAIL',
          externalReferenceId: 'tx-local-2',
        }),
      );

      expect(deepSerialize(logger.args)).not.toContain(PIX_KEY);
      expect(deepSerialize(error)).not.toContain(PIX_KEY);
    });
  });

  describe('não vazamento da API key', () => {
    /**
     * O ponto crítico da integração: a chave está no header de TODA
     * requisição e o `AxiosError` carrega `config.headers` inteiro. Estes
     * testes serializam profundamente (inclusive props não enumeráveis e
     * `cause`) tanto a exceção lançada quanto TODOS os argumentos
     * recebidos pelo Logger.
     */
    const scenarios: Array<{
      name: string;
      failure: () => unknown;
    }> = [
      {
        name: '4xx cujo corpo ecoa a credencial enviada',
        failure: () =>
          httpErrorOf(401, {
            message: `invalid api key: ${API_KEY}`,
            apiKey: API_KEY,
            headers: { Authorization: `Bearer ${API_KEY}` },
          }),
      },
      {
        name: '5xx com a credencial na mensagem do erro',
        failure: () => httpErrorOf(500, { detail: API_KEY }),
      },
      { name: 'timeout', failure: () => timeoutErrorOf() },
      { name: 'erro de rede', failure: () => networkErrorOf() },
    ];

    it.each(scenarios)(
      'não serializa a API key em erro nem em log — cenário: $name',
      async ({ failure }) => {
        const { client, request, logger } = buildClient();
        request.mockReturnValue(throwError(() => failure()));

        const error = await captureError(
          client.createPixCharge({
            amount: '125.50',
            externalReferenceId: 'tx-local-1',
          }),
        );

        expect(deepSerialize(error)).not.toContain(API_KEY);
        expect(deepSerialize(logger.args)).not.toContain(API_KEY);
        expect(logger.args.length).toBeGreaterThan(0);
      },
    );

    it('não vaza a API key no log de sucesso (debug)', async () => {
      const { client, request, logger } = buildClient();
      request.mockReturnValue(of(okResponse(CHARGE_PAYLOAD)));

      await client.createPixCharge({
        amount: '125.50',
        externalReferenceId: 'tx-local-1',
      });

      expect(logger.debug).toHaveBeenCalled();
      expect(deepSerialize(logger.args)).not.toContain(API_KEY);
    });

    it('não vaza a API key quando ela aparece no corpo de uma resposta 2xx inesperada', async () => {
      const { client, request, logger } = buildClient();
      request.mockReturnValue(
        of(okResponse({ data: { echo: `key=${API_KEY}` }, error: null })),
      );

      const error = await captureError(
        client.createPixCharge({
          amount: '125.50',
          externalReferenceId: 'tx-local-1',
        }),
      );

      expect(error).toBeInstanceOf(AbacatePayUnexpectedResponseError);
      expect(deepSerialize(error)).not.toContain(API_KEY);
      expect(deepSerialize(logger.args)).not.toContain(API_KEY);
    });

    it('avisa (sem valor) quando a API key não está configurada', () => {
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);

      const configService = {
        get: jest.fn().mockReturnValue({ baseUrl: BASE_URL }),
      } as unknown as ConfigService;

      new AbacatePayClient(
        { request: jest.fn() } as unknown as HttpService,
        configService,
      );

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('ABACATEPAY_API_KEY ausente'),
      );
    });

    it('usa os defaults quando o namespace de config está ausente', async () => {
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const configService = {
        get: jest.fn().mockReturnValue(undefined),
      } as unknown as ConfigService;
      const request = jest.fn().mockReturnValue(of(okResponse(CHARGE_PAYLOAD)));
      const client = new AbacatePayClient(
        { request } as unknown as HttpService,
        configService,
      );
      jest
        .spyOn((client as unknown as { logger: Logger }).logger, 'debug')
        .mockImplementation(() => undefined);

      await client.createPixCharge({
        amount: '125.50',
        externalReferenceId: 'tx-local-1',
      });

      const sentConfig = request.mock.calls[0][0] as AxiosRequestConfig;
      expect(sentConfig.baseURL).toBe('https://api.abacatepay.com/v1');
      expect(sentConfig.timeout).toBe(10_000);
    });
  });
});
