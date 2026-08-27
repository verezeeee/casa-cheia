/**
 * Setup de ambiente das suítes e2e/integração.
 *
 * Roda em `setupFiles` (antes do framework de teste e, principalmente, antes
 * de qualquer `import` do AppModule) porque o `ConfigModule` valida
 * `process.env` com Joi já no carregamento do módulo: se as variáveis não
 * estiverem presentes neste ponto, o boot falha (fail-fast) e a suíte inteira
 * quebra por configuração, não por regressão de código.
 *
 * Regras:
 *  - Nada aqui sobrescreve uma variável já definida pelo ambiente. Isso
 *    permite que o CI injete seus próprios valores (ver .github/workflows/ci.yml)
 *    sem que o arquivo de setup interfira.
 *  - `DATABASE_URL_TEST`, quando presente, TEM PRECEDÊNCIA sobre `DATABASE_URL`.
 *    É a trava que impede uma suíte destrutiva de rodar contra o banco de
 *    desenvolvimento local por esquecimento.
 */

const TEST_ENV_DEFAULTS: Readonly<Record<string, string>> = {
  NODE_ENV: 'test',
  PORT: '3001',
  API_PREFIX: 'api',
  // Silencia o logger nas suítes: o ruído do pino atrapalha a leitura das falhas.
  LOG_LEVEL: 'silent',

  DATABASE_URL:
    'postgresql://poker:poker@localhost:5433/poker_system_test?schema=public',

  JWT_SECRET: 'e2e-only-jwt-secret-not-for-production',
  JWT_EXPIRES_IN: '15m',
  JWT_REFRESH_SECRET: 'e2e-only-jwt-refresh-secret-not-for-production',
  JWT_REFRESH_EXPIRES_IN: '7d',

  ABACATEPAY_API_KEY: 'e2e-test-abacatepay-key',
  ABACATEPAY_BASE_URL: 'https://api.abacatepay.com/v2',
  ABACATEPAY_WEBHOOK_SECRET: 'e2e-test-abacatepay-webhook-secret',
  ABACATEPAY_WEBHOOK_TOLERANCE_SECONDS: '300',

  COOKIE_DOMAIN: '',
  COOKIE_SECURE: 'false',
  CORS_ORIGINS: 'http://localhost:3000',

  // Limite alto de propósito: rate limiting não deve derrubar suítes que
  // disparam muitas requisições em sequência. Testes do próprio throttler
  // devem sobrescrever esses valores localmente.
  RATE_LIMIT_TTL: '60',
  RATE_LIMIT_LIMIT: '1000',

  WALLET_MIN_DEPOSIT: '10.00',
  WALLET_MAX_DEPOSIT: '50000.00',
  WALLET_MIN_WITHDRAWAL: '10.00',
};

// Banco de teste dedicado tem precedência sobre a URL de desenvolvimento.
if (process.env.DATABASE_URL_TEST) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
}

for (const [key, value] of Object.entries(TEST_ENV_DEFAULTS)) {
  if (process.env[key] === undefined || process.env[key] === '') {
    process.env[key] = value;
  }
}

// COOKIE_DOMAIN é legitimamente vazio; o loop acima o trata como "ausente",
// então garantimos a chave definida para não cair em `undefined`.
process.env.COOKIE_DOMAIN ??= '';

// Conexão com o role de aplicação (poker_app: NOSUPERUSER, NOBYPASSRLS, criado
// por docker/postgres/init/01-app-role.sql). Ainda não é consumida por nenhum
// código: fica disponível para as suítes de RLS (CL-TEST-01), que precisam
// falar com o banco como a aplicação fala - RLS é ignorado para o owner
// "poker" usado pelas migrations, então testar com DATABASE_URL não provaria
// nada. Derivada da URL de teste efetiva para valer também no CI, onde o
// host/porta do Postgres não são os do docker-compose.
if (!process.env.DATABASE_URL_APP_TEST) {
  const url = new URL(process.env.DATABASE_URL as string);
  url.username = 'poker_app';
  url.password = process.env.POKER_APP_DB_PASSWORD ?? 'poker_app';
  process.env.DATABASE_URL_APP_TEST = url.toString();
}
