import { registerAs } from '@nestjs/config';

/**
 * Configurações tipadas, agrupadas por domínio, expostas via
 * `ConfigService.get<T>('app' | 'database' | 'jwt' | 'abacatePay' |
 * 'security' | 'wallet')`.
 * Mantém o resto da aplicação desacoplado de `process.env` cru.
 *
 * Os defaults repetidos aqui são redundantes por design: o `envValidationSchema`
 * (Joi) já os aplica no boot e o `ConfigModule` os escreve de volta em
 * `process.env`. Repeti-los mantém cada factory utilizável isoladamente
 * (testes unitários, scripts CLI) sem depender do ciclo de vida do Nest.
 */

/** Converte uma env string em booleano, caindo no fallback quando ausente/vazia. */
const toBoolean = (value: string | undefined, fallback: boolean): boolean =>
  value === undefined || value === '' ? fallback : value === 'true';

export const appConfig = registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3001', 10),
  apiPrefix: process.env.API_PREFIX ?? 'api',
  logLevel: process.env.LOG_LEVEL ?? 'info',
}));

export const databaseConfig = registerAs('database', () => ({
  url: process.env.DATABASE_URL,
}));

export const jwtConfig = registerAs('jwt', () => ({
  secret: process.env.JWT_SECRET,
  expiresIn: process.env.JWT_EXPIRES_IN ?? '15m',
  refreshSecret: process.env.JWT_REFRESH_SECRET,
  refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
}));

export const abacatePayConfig = registerAs('abacatePay', () => ({
  apiKey: process.env.ABACATEPAY_API_KEY,
  baseUrl: process.env.ABACATEPAY_BASE_URL ?? 'https://api.abacatepay.com/v2',
  webhookSecret: process.env.ABACATEPAY_WEBHOOK_SECRET,
}));

/**
 * Configurações de borda: cookies de sessão, CORS e rate limiting.
 *
 * `cookieSecure` cai para `true` por padrão quando `NODE_ENV=production` —
 * o mesmo invariante é reforçado pelo Joi (fail-fast) em `env.validation.ts`;
 * aqui garantimos o default seguro mesmo se a factory for usada fora do boot.
 */
export const securityConfig = registerAs('security', () => {
  const nodeEnv = process.env.NODE_ENV ?? 'development';

  return {
    cookieDomain: process.env.COOKIE_DOMAIN || undefined,
    cookieSecure: toBoolean(
      process.env.COOKIE_SECURE,
      nodeEnv === 'production',
    ),
    corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
    rateLimit: {
      ttl: parseInt(process.env.RATE_LIMIT_TTL ?? '60', 10),
      limit: parseInt(process.env.RATE_LIMIT_LIMIT ?? '10', 10),
    },
  };
});

/**
 * Limites monetários da carteira virtual.
 *
 * IMPORTANTE: mantidos como STRING de propósito, nunca `number`. Todo valor
 * monetário do sistema é `Decimal` (NUMERIC no Postgres via Prisma); passar
 * por `number` (IEEE-754) introduziria erro de arredondamento binário em
 * comparações de saldo/limite. Consumidores devem fazer
 * `new Prisma.Decimal(config.minDeposit)`.
 */
export const walletConfig = registerAs('wallet', () => ({
  minDeposit: process.env.WALLET_MIN_DEPOSIT ?? '10.00',
  maxDeposit: process.env.WALLET_MAX_DEPOSIT ?? '50000.00',
  minWithdrawal: process.env.WALLET_MIN_WITHDRAWAL ?? '10.00',
  /** Ver docblock de `PAYMENTS_ENABLED` em `env.validation.ts`. Default standby. */
  paymentsEnabled: toBoolean(process.env.PAYMENTS_ENABLED, false),
}));
