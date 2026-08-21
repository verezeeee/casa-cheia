import * as publicApi from './index';

/**
 * Guarda a superfície pública da integração: outras tasks (depósito/saque
 * PIX) importam daqui, então uma remoção acidental de export deve quebrar
 * um teste, não a build de quem consome.
 */
describe('integrations/abacatepay (barrel)', () => {
  it('exporta client, módulo e erros de domínio', () => {
    expect(Object.keys(publicApi).sort()).toEqual(
      [
        'ABACATEPAY_ENDPOINTS',
        'AbacatePayClient',
        'AbacatePayError',
        'AbacatePayInvalidAmountError',
        'AbacatePayModule',
        'AbacatePayRequestError',
        'AbacatePayUnavailableError',
        'AbacatePayUnexpectedResponseError',
        'DEFAULT_BASE_URL',
        'DEFAULT_RETRY_DELAY_MS',
        'DEFAULT_TIMEOUT_MS',
        'MAX_ATTEMPTS',
      ].sort(),
    );
  });

  it('resolve cada símbolo exportado', () => {
    expect(publicApi.ABACATEPAY_ENDPOINTS.createPixCharge).toEqual(
      expect.any(String),
    );
    expect(publicApi.AbacatePayClient).toBeDefined();
    expect(publicApi.AbacatePayModule).toBeDefined();
    expect(publicApi.AbacatePayError).toBeDefined();
    expect(publicApi.AbacatePayInvalidAmountError).toBeDefined();
    expect(publicApi.AbacatePayRequestError).toBeDefined();
    expect(publicApi.AbacatePayUnavailableError).toBeDefined();
    expect(publicApi.AbacatePayUnexpectedResponseError).toBeDefined();
    expect(publicApi.DEFAULT_BASE_URL).toContain('abacatepay');
    expect(publicApi.DEFAULT_RETRY_DELAY_MS).toBeGreaterThan(0);
    expect(publicApi.DEFAULT_TIMEOUT_MS).toBe(10_000);
  });

  it('mantém a política de 1 chamada + 1 retry', () => {
    expect(publicApi.MAX_ATTEMPTS).toBe(2);
  });

  it('expõe uma hierarquia de erros com raiz comum (catch único no chamador)', () => {
    const error = new publicApi.AbacatePayRequestError('x', 'op', {
      status: 400,
      responseBody: null,
    });

    expect(error).toBeInstanceOf(publicApi.AbacatePayError);
    expect(error.name).toBe('AbacatePayRequestError');
  });
});
