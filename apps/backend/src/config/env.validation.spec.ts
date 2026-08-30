import { envValidationSchema } from './env.validation';

describe('envValidationSchema', () => {
  const validEnv = {
    NODE_ENV: 'test',
    PORT: '3001',
    DATABASE_URL: 'postgresql://poker:poker@localhost:5432/poker_system',
    JWT_SECRET: 'a-secret-with-more-than-16-chars',
    JWT_REFRESH_SECRET: 'another-secret-with-more-than-16-chars',
    ABACATEPAY_API_KEY: 'abacatepay_test_key',
    ABACATEPAY_WEBHOOK_SECRET: 'abacatepay_webhook_secret',
  };

  it('aceita um conjunto de variáveis de ambiente válido e aplica defaults', () => {
    const { error, value } = envValidationSchema.validate(validEnv);

    expect(error).toBeUndefined();
    expect(value.PORT).toBe(3001);
    expect(value.API_PREFIX).toBe('api');
    expect(value.JWT_EXPIRES_IN).toBe('15m');
    expect(value.LOG_LEVEL).toBe('info');
  });

  it('rejeita quando DATABASE_URL está ausente', () => {
    const rest: Partial<typeof validEnv> = { ...validEnv };
    delete rest.DATABASE_URL;
    const { error } = envValidationSchema.validate(rest);

    expect(error).toBeDefined();
    expect(error?.message).toContain('DATABASE_URL');
  });

  it('rejeita quando JWT_SECRET é muito curto', () => {
    const { error } = envValidationSchema.validate({
      ...validEnv,
      JWT_SECRET: 'short',
    });

    expect(error).toBeDefined();
    expect(error?.message).toMatch(/JWT_SECRET/);
  });

  it('aceita ABACATEPAY_API_KEY/ABACATEPAY_WEBHOOK_SECRET ausentes — gateway em standby', () => {
    const rest: Partial<typeof validEnv> = { ...validEnv };
    delete rest.ABACATEPAY_API_KEY;
    delete rest.ABACATEPAY_WEBHOOK_SECRET;
    const { error } = envValidationSchema.validate(rest);

    expect(error).toBeUndefined();
  });

  it('rejeita NODE_ENV com valor fora do enum permitido', () => {
    const { error } = envValidationSchema.validate({
      ...validEnv,
      NODE_ENV: 'staging-invalido',
    });

    expect(error).toBeDefined();
  });

  it('rejeita DATABASE_URL que não seja uma URI postgresql válida', () => {
    const { error } = envValidationSchema.validate({
      ...validEnv,
      DATABASE_URL: 'mysql://user:pass@localhost:3306/db',
    });

    expect(error).toBeDefined();
  });

  describe('cookies e CORS', () => {
    it('usa os defaults de COOKIE_DOMAIN/COOKIE_SECURE/CORS_ORIGINS quando ausentes', () => {
      const { error, value } = envValidationSchema.validate(validEnv);

      expect(error).toBeUndefined();
      expect(value.COOKIE_DOMAIN).toBe('');
      expect(value.COOKIE_SECURE).toBe(false);
      expect(value.CORS_ORIGINS).toBe('http://localhost:3000');
    });

    it('coage COOKIE_SECURE de string para booleano', () => {
      const { error, value } = envValidationSchema.validate({
        ...validEnv,
        COOKIE_SECURE: 'true',
      });

      expect(error).toBeUndefined();
      expect(value.COOKIE_SECURE).toBe(true);
    });

    it('rejeita COOKIE_SECURE com valor não-booleano', () => {
      const { error } = envValidationSchema.validate({
        ...validEnv,
        COOKIE_SECURE: 'yes-please',
      });

      expect(error).toBeDefined();
      expect(error?.message).toContain('COOKIE_SECURE');
    });

    it('força COOKIE_SECURE=true por default quando NODE_ENV=production', () => {
      const { error, value } = envValidationSchema.validate({
        ...validEnv,
        NODE_ENV: 'production',
      });

      expect(error).toBeUndefined();
      expect(value.COOKIE_SECURE).toBe(true);
    });

    it('rejeita COOKIE_SECURE=false quando NODE_ENV=production', () => {
      const { error } = envValidationSchema.validate({
        ...validEnv,
        NODE_ENV: 'production',
        COOKIE_SECURE: 'false',
      });

      expect(error).toBeDefined();
      expect(error?.message).toContain('COOKIE_SECURE');
    });

    it('aceita CORS_ORIGINS com múltiplas origens separadas por vírgula', () => {
      const { error, value } = envValidationSchema.validate({
        ...validEnv,
        CORS_ORIGINS: 'http://localhost:3000,https://app.exemplo.com',
      });

      expect(error).toBeUndefined();
      expect(value.CORS_ORIGINS).toBe(
        'http://localhost:3000,https://app.exemplo.com',
      );
    });
  });

  describe('rate limiting', () => {
    it('usa os defaults de RATE_LIMIT_TTL e RATE_LIMIT_LIMIT quando ausentes', () => {
      const { error, value } = envValidationSchema.validate(validEnv);

      expect(error).toBeUndefined();
      expect(value.RATE_LIMIT_TTL).toBe(60);
      expect(value.RATE_LIMIT_LIMIT).toBe(10);
    });

    it('rejeita RATE_LIMIT_LIMIT não-numérico', () => {
      const { error } = envValidationSchema.validate({
        ...validEnv,
        RATE_LIMIT_LIMIT: 'muitas',
      });

      expect(error).toBeDefined();
      expect(error?.message).toContain('RATE_LIMIT_LIMIT');
    });

    it('rejeita RATE_LIMIT_TTL não-numérico', () => {
      const { error } = envValidationSchema.validate({
        ...validEnv,
        RATE_LIMIT_TTL: 'um-minuto',
      });

      expect(error).toBeDefined();
      expect(error?.message).toContain('RATE_LIMIT_TTL');
    });

    it('rejeita RATE_LIMIT_LIMIT igual a zero', () => {
      const { error } = envValidationSchema.validate({
        ...validEnv,
        RATE_LIMIT_LIMIT: '0',
      });

      expect(error).toBeDefined();
    });
  });

  describe('limites monetários da carteira', () => {
    it('usa os defaults decimais quando ausentes e os mantém como string', () => {
      const { error, value } = envValidationSchema.validate(validEnv);

      expect(error).toBeUndefined();
      expect(value.WALLET_MIN_DEPOSIT).toBe('10.00');
      expect(value.WALLET_MAX_DEPOSIT).toBe('50000.00');
      expect(value.WALLET_MIN_WITHDRAWAL).toBe('10.00');
      expect(typeof value.WALLET_MIN_DEPOSIT).toBe('string');
      expect(typeof value.WALLET_MAX_DEPOSIT).toBe('string');
    });

    it.each([
      ['WALLET_MIN_DEPOSIT'],
      ['WALLET_MAX_DEPOSIT'],
      ['WALLET_MIN_WITHDRAWAL'],
    ])('rejeita %s com formato decimal inválido', (key) => {
      const { error } = envValidationSchema.validate({
        ...validEnv,
        [key]: '10,00',
      });

      expect(error).toBeDefined();
      expect(error?.message).toContain(key);
    });

    it('rejeita valor monetário com mais de duas casas decimais', () => {
      const { error } = envValidationSchema.validate({
        ...validEnv,
        WALLET_MIN_DEPOSIT: '10.000',
      });

      expect(error).toBeDefined();
      expect(error?.message).toContain('WALLET_MIN_DEPOSIT');
    });

    it('aceita valores monetários válidos customizados', () => {
      const { error, value } = envValidationSchema.validate({
        ...validEnv,
        WALLET_MIN_DEPOSIT: '5',
        WALLET_MAX_DEPOSIT: '1000.5',
        WALLET_MIN_WITHDRAWAL: '25.50',
      });

      expect(error).toBeUndefined();
      expect(value.WALLET_MIN_DEPOSIT).toBe('5');
      expect(value.WALLET_MAX_DEPOSIT).toBe('1000.5');
      expect(value.WALLET_MIN_WITHDRAWAL).toBe('25.50');
    });
  });

  describe('PAYMENTS_ENABLED (módulo de pagamento em standby)', () => {
    it('default é false (standby) quando ausente', () => {
      const { error, value } = envValidationSchema.validate(validEnv);

      expect(error).toBeUndefined();
      expect(value.PAYMENTS_ENABLED).toBe(false);
    });

    it('aceita true explícito', () => {
      const { error, value } = envValidationSchema.validate({
        ...validEnv,
        PAYMENTS_ENABLED: 'true',
      });

      expect(error).toBeUndefined();
      expect(value.PAYMENTS_ENABLED).toBe(true);
    });

    it('rejeita valor não-booleano', () => {
      const { error } = envValidationSchema.validate({
        ...validEnv,
        PAYMENTS_ENABLED: 'talvez',
      });

      expect(error).toBeDefined();
      expect(error?.message).toContain('PAYMENTS_ENABLED');
    });
  });
});
