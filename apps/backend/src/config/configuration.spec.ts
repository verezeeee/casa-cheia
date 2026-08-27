import {
  abacatePayConfig,
  appConfig,
  databaseConfig,
  jwtConfig,
  securityConfig,
  walletConfig,
} from './configuration';

describe('configuration factories', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('appConfig aplica defaults quando envs opcionais estão ausentes', () => {
    delete process.env.PORT;
    delete process.env.API_PREFIX;
    delete process.env.LOG_LEVEL;

    expect(appConfig()).toEqual({
      nodeEnv: process.env.NODE_ENV ?? 'development',
      port: 3001,
      apiPrefix: 'api',
      logLevel: 'info',
    });
  });

  it('appConfig lê valores customizados quando presentes', () => {
    process.env.PORT = '4000';
    process.env.API_PREFIX = 'v2';
    process.env.LOG_LEVEL = 'debug';

    const config = appConfig();
    expect(config.port).toBe(4000);
    expect(config.apiPrefix).toBe('v2');
    expect(config.logLevel).toBe('debug');
  });

  it('databaseConfig expõe a DATABASE_URL', () => {
    process.env.DATABASE_URL =
      'postgresql://poker:poker@localhost:5432/poker_system';
    expect(databaseConfig().url).toBe(
      'postgresql://poker:poker@localhost:5432/poker_system',
    );
  });

  it('jwtConfig aplica defaults de expiração e lê os segredos', () => {
    process.env.JWT_SECRET = 'secret-jwt';
    process.env.JWT_REFRESH_SECRET = 'secret-refresh';
    delete process.env.JWT_EXPIRES_IN;
    delete process.env.JWT_REFRESH_EXPIRES_IN;

    expect(jwtConfig()).toEqual({
      secret: 'secret-jwt',
      expiresIn: '15m',
      refreshSecret: 'secret-refresh',
      refreshExpiresIn: '7d',
    });
  });

  it('abacatePayConfig aplica baseUrl default e lê chave/segredo', () => {
    process.env.ABACATEPAY_API_KEY = 'key-123';
    process.env.ABACATEPAY_WEBHOOK_SECRET = 'webhook-secret';
    delete process.env.ABACATEPAY_BASE_URL;

    expect(abacatePayConfig()).toEqual({
      apiKey: 'key-123',
      baseUrl: 'https://api.abacatepay.com/v2',
      webhookSecret: 'webhook-secret',
    });
  });

  describe('securityConfig', () => {
    beforeEach(() => {
      delete process.env.COOKIE_DOMAIN;
      delete process.env.COOKIE_SECURE;
      delete process.env.CORS_ORIGINS;
      delete process.env.RATE_LIMIT_TTL;
      delete process.env.RATE_LIMIT_LIMIT;
    });

    it('aplica defaults de desenvolvimento quando as envs estão ausentes', () => {
      process.env.NODE_ENV = 'development';

      expect(securityConfig()).toEqual({
        cookieDomain: undefined,
        cookieSecure: false,
        corsOrigins: ['http://localhost:3000'],
        rateLimit: { ttl: 60, limit: 10 },
      });
    });

    it('assume cookieSecure=true por default em produção', () => {
      process.env.NODE_ENV = 'production';

      expect(securityConfig().cookieSecure).toBe(true);
    });

    it('respeita COOKIE_SECURE explícito e expõe COOKIE_DOMAIN', () => {
      process.env.NODE_ENV = 'development';
      process.env.COOKIE_SECURE = 'true';
      process.env.COOKIE_DOMAIN = '.poker-system.app';

      const config = securityConfig();
      expect(config.cookieSecure).toBe(true);
      expect(config.cookieDomain).toBe('.poker-system.app');
    });

    it('trata COOKIE_DOMAIN vazio como undefined (cookie host-only)', () => {
      process.env.COOKIE_DOMAIN = '';

      expect(securityConfig().cookieDomain).toBeUndefined();
    });

    it('converte CORS_ORIGINS em array, aparando espaços e itens vazios', () => {
      process.env.CORS_ORIGINS =
        ' http://localhost:3000 , https://app.exemplo.com ,,';

      expect(securityConfig().corsOrigins).toEqual([
        'http://localhost:3000',
        'https://app.exemplo.com',
      ]);
    });

    it('lê os limites de rate limiting como números', () => {
      process.env.RATE_LIMIT_TTL = '30';
      process.env.RATE_LIMIT_LIMIT = '5';

      expect(securityConfig().rateLimit).toEqual({ ttl: 30, limit: 5 });
    });
  });

  describe('walletConfig', () => {
    it('aplica os limites default quando as envs estão ausentes', () => {
      delete process.env.WALLET_MIN_DEPOSIT;
      delete process.env.WALLET_MAX_DEPOSIT;
      delete process.env.WALLET_MIN_WITHDRAWAL;

      expect(walletConfig()).toEqual({
        minDeposit: '10.00',
        maxDeposit: '50000.00',
        minWithdrawal: '10.00',
      });
    });

    it('mantém os valores monetários como string (nunca number)', () => {
      process.env.WALLET_MIN_DEPOSIT = '20.00';
      process.env.WALLET_MAX_DEPOSIT = '10000.00';
      process.env.WALLET_MIN_WITHDRAWAL = '30.50';

      const config = walletConfig();
      expect(config).toEqual({
        minDeposit: '20.00',
        maxDeposit: '10000.00',
        minWithdrawal: '30.50',
      });
      expect(typeof config.minDeposit).toBe('string');
      expect(typeof config.maxDeposit).toBe('string');
      expect(typeof config.minWithdrawal).toBe('string');
    });
  });
});
