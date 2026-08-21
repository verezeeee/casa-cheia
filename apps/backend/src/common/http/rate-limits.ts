/**
 * Limite estrito aplicado via `@Throttle()` nas rotas sensíveis (login,
 * depósito, saque) — força de bruta e abuso de gateway de pagamento.
 * O guard global (`ThrottlerModule` em `app.module.ts`) usa um limite mais
 * generoso, que não atrapalha tráfego normal (ex.: polling de assentos).
 *
 * `RATE_LIMIT_TTL`/`RATE_LIMIT_LIMIT` já existem em `configuration.ts`
 * (`security.rateLimit`); lidos direto de `process.env` aqui pelo mesmo
 * motivo documentado lá — mantém este módulo utilizável isoladamente sem
 * depender do ciclo de vida do Nest, já que `@Throttle()` precisa de um
 * valor estático no momento da definição da classe.
 */
export const SENSITIVE_ROUTE_THROTTLE = {
  default: {
    ttl: parseInt(process.env.RATE_LIMIT_TTL ?? '60', 10) * 1000,
    limit: parseInt(process.env.RATE_LIMIT_LIMIT ?? '10', 10),
  },
};
