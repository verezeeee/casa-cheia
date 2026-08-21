import * as Joi from 'joi';

/**
 * Valores monetários (limites de carteira) são validados como STRING no
 * formato decimal "0.00" — nunca como `Joi.number()`. Motivo: dinheiro é
 * persistido como `Decimal` (NUMERIC) no Postgres/Prisma e converter para
 * `number` (IEEE-754 double) introduz erro de arredondamento binário.
 * A string validada é repassada intacta ao construtor do `Decimal`.
 */
const decimalString = (label: string) =>
  Joi.string()
    .pattern(/^\d+(\.\d{1,2})?$/)
    .messages({
      'string.pattern.base': `${label} deve ser um decimal em formato monetário, ex: "10.00".`,
    });

/**
 * Schema de validação das variáveis de ambiente do backend.
 *
 * É usado como `validationSchema` do `ConfigModule.forRoot`. O Nest chama
 * `.validate()` durante a inicialização do módulo; se o schema falhar, uma
 * exceção é lançada e o processo de boot é interrompido ANTES de o Nest
 * criar qualquer controller/provider — ou seja, a aplicação nunca sobe com
 * uma configuração inválida ou incompleta (fail-fast).
 *
 * Decisão técnica: Joi (em vez de class-validator) porque o alvo aqui é um
 * objeto simples (`process.env`), não uma classe de domínio — o próprio
 * NestJS documenta esse uso e o Joi permite defaults, coerção de tipos
 * (string -> number) e mensagens declarativas em um único schema conciso.
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),

  PORT: Joi.number().port().default(3001),
  API_PREFIX: Joi.string().default('api'),
  LOG_LEVEL: Joi.string()
    .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent')
    .default('info'),

  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgresql', 'postgres'] })
    .required()
    .messages({
      'any.required':
        'DATABASE_URL é obrigatória (string de conexão do PostgreSQL).',
      'string.uriCustomScheme':
        'DATABASE_URL deve ser uma URI postgresql:// válida.',
    }),

  JWT_SECRET: Joi.string().min(16).required().messages({
    'any.required': 'JWT_SECRET é obrigatória.',
    'string.min': 'JWT_SECRET deve ter ao menos 16 caracteres.',
  }),
  JWT_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_SECRET: Joi.string().min(16).required().messages({
    'any.required': 'JWT_REFRESH_SECRET é obrigatória.',
    'string.min': 'JWT_REFRESH_SECRET deve ter ao menos 16 caracteres.',
  }),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),

  ABACATEPAY_API_KEY: Joi.string().required().messages({
    'any.required':
      'ABACATEPAY_API_KEY é obrigatória para integração PIX (AbacatePay).',
  }),
  ABACATEPAY_BASE_URL: Joi.string()
    .uri()
    .default('https://api.abacatepay.com/v2'),
  ABACATEPAY_WEBHOOK_SECRET: Joi.string().required().messages({
    'any.required':
      'ABACATEPAY_WEBHOOK_SECRET é obrigatória para validar a assinatura dos webhooks PIX.',
  }),
  // Janela anti-replay do webhook: um evento com timestamp mais antigo que
  // esta tolerância é rejeitado mesmo com assinatura válida.
  ABACATEPAY_WEBHOOK_TOLERANCE_SECONDS: Joi.number()
    .integer()
    .min(1)
    .max(3600)
    .default(300)
    .messages({
      'number.base':
        'ABACATEPAY_WEBHOOK_TOLERANCE_SECONDS deve ser um número inteiro de segundos.',
      'number.max':
        'ABACATEPAY_WEBHOOK_TOLERANCE_SECONDS não deve exceder 3600s (1h) — janelas largas enfraquecem a proteção anti-replay.',
    }),

  // ---------------------------------------------------------------------------
  // Sessão / cookies / CORS
  // ---------------------------------------------------------------------------
  // Vazio => o browser usa o host da resposta (host-only cookie), que é o
  // comportamento desejado em desenvolvimento.
  COOKIE_DOMAIN: Joi.string().allow('').default(''),

  /**
   * Em produção o cookie de refresh token DEVE trafegar apenas sobre TLS.
   * A regra condicional abaixo transforma esse requisito de segurança em
   * fail-fast de boot: com `NODE_ENV=production`, `COOKIE_SECURE=false`
   * derruba o processo em vez de degradar silenciosamente a segurança.
   */
  COOKIE_SECURE: Joi.boolean()
    .default(false)
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.boolean().valid(true).default(true).messages({
        'any.only':
          'COOKIE_SECURE deve ser true quando NODE_ENV=production (cookies de sessão só podem trafegar sobre HTTPS).',
      }),
    })
    .messages({
      'boolean.base': 'COOKIE_SECURE deve ser um booleano ("true" ou "false").',
    }),

  // Lista separada por vírgula das origens autorizadas pelo CORS.
  CORS_ORIGINS: Joi.string().default('http://localhost:3000').messages({
    'string.base':
      'CORS_ORIGINS deve ser uma lista de origens separadas por vírgula, ex: "http://localhost:3000,https://app.exemplo.com".',
  }),

  // ---------------------------------------------------------------------------
  // Rate limiting (throttler) — janela padrão aplicada às rotas sensíveis.
  // ---------------------------------------------------------------------------
  RATE_LIMIT_TTL: Joi.number().integer().min(1).default(60).messages({
    'number.base': 'RATE_LIMIT_TTL deve ser um número inteiro de segundos.',
  }),
  RATE_LIMIT_LIMIT: Joi.number().integer().min(1).default(10).messages({
    'number.base':
      'RATE_LIMIT_LIMIT deve ser um número inteiro de requisições por janela.',
  }),

  // ---------------------------------------------------------------------------
  // Carteira virtual — limites monetários (strings decimais, ver `decimalString`)
  // ---------------------------------------------------------------------------
  WALLET_MIN_DEPOSIT: decimalString('WALLET_MIN_DEPOSIT').default('10.00'),
  WALLET_MAX_DEPOSIT: decimalString('WALLET_MAX_DEPOSIT').default('50000.00'),
  WALLET_MIN_WITHDRAWAL: decimalString('WALLET_MIN_WITHDRAWAL').default(
    '10.00',
  ),
}).unknown(true);
