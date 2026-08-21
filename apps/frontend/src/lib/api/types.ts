/**
 * DTOs de REQUEST das chamadas de API do frontend.
 *
 * Os DTOs de RESPONSE não moram aqui: eles são contratos compartilhados com o
 * backend e vêm de `@poker-system/shared` (`AuthTokensResponse`, `SessionUser`,
 * ...). Duplicá-los aqui abriria espaço para divergência silenciosa entre as
 * duas pontas.
 */

/** Corpo de `POST /auth/register`. */
export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
  /** CPF/CNPJ. Opcional no cadastro; exigido apenas para operações PIX. */
  document?: string;
}

/** Corpo de `POST /auth/login`. */
export interface LoginRequest {
  email: string;
  password: string;
}

/** Corpo de `POST /wallet/deposits`. */
export interface CreateDepositRequest {
  /** String decimal ("50.00") — nunca `number`, ver `@poker-system/shared/types/money`. */
  amount: string;
}

/** Corpo de `POST /wallet/withdrawals`. */
export interface RequestWithdrawalRequest {
  amount: string;
  pixKey: string;
  pixKeyType: 'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'RANDOM';
}
