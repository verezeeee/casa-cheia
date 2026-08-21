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

/** Corpo de `POST /tables` (ADMIN). */
export interface CreateTableRequest {
  name: string;
  type: 'CASH_GAME' | 'TOURNAMENT';
  smallBlind: string;
  bigBlind: string;
  minBuyIn: string;
  maxBuyIn: string;
  maxSeats: number;
  rakePercent?: string;
}

/** Corpo de `POST /tables/:id/sit`. */
export interface SitAtTableRequest {
  seatNumber: number;
  buyInAmount: string;
}

/** Corpo de `POST /tables/:id/sessions/:sessionId/movements` (ADMIN). */
export interface RecordMovementRequest {
  amount: string;
  reason: 'HAND_RESULT' | 'ADJUSTMENT';
}

/** Uma faixa da grade de premiação em `POST /tournaments`. */
export interface TournamentPrizeInput {
  position: number;
  /** String decimal, ex.: "40.00" = 40%. A soma das faixas precisa fechar 100.00. */
  percentage: string;
}

/** Corpo de `POST /tournaments` (ADMIN). */
export interface CreateTournamentRequest {
  name: string;
  buyIn: string;
  fee: string;
  startingStack: number;
  maxPlayers: number;
  /** ISO 8601. */
  startsAt: string;
  prizes: TournamentPrizeInput[];
}

/** Corpo de `POST /tournaments/:id/entries/:entryId/eliminate` (ADMIN). */
export interface EliminateEntryRequest {
  finalPosition?: number;
}
