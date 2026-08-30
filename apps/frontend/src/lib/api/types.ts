/**
 * DTOs de REQUEST das chamadas de API do frontend.
 *
 * Os DTOs de RESPONSE não moram aqui: eles são contratos compartilhados com o
 * backend e vêm de `@poker-system/shared` (`AuthTokensResponse`, `SessionUser`,
 * ...). Duplicá-los aqui abriria espaço para divergência silenciosa entre as
 * duas pontas.
 */
import type { BlindLevelDto } from '@poker-system/shared';

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
  /** Assentos por mesa aberta pelo torneio. Ausente = 9 (default do backend). */
  tableCapacity?: number;
  /** Preset de blinds a COPIAR na criação. Ausente = torneio sem relógio. */
  blindStructureId?: string;
  /** `false`/ausente = freezeout. */
  allowReentry?: boolean;
  /** Reentradas por jogador. Ausente = ilimitado. */
  maxReentries?: number;
  /** Último nível em que se pode reentrar. Ausente = sem corte. */
  reentryUntilLevel?: number;
  /**
   * Bônus de staff (staff add-on), OPCIONAL por jogador na inscrição. Precisa
   * vir junto de `staffBonusChips` — um sem o outro é 400 no backend.
   */
  staffBonusCost?: string;
  /** Fichas extras concedidas a quem paga o bônus de staff. */
  staffBonusChips?: number;
  prizes: TournamentPrizeInput[];
}

/** Corpo de `POST /tournaments/:id/entries/:entryId/eliminate` (ADMIN). */
export interface EliminateEntryRequest {
  finalPosition?: number;
}

/** Corpo de `POST /tournaments/:id/register`. */
export interface RegisterEntryRequest {
  /** Opção pelo bônus de staff. Ausente/`false` = não paga. */
  staffBonus?: boolean;
}

/**
 * Um nível na criação/substituição de um preset de blinds.
 *
 * Herda os campos obrigatórios do DTO de resposta para não divergir dele; o
 * que muda no request é só a opcionalidade (`ante`, `isBreak` e `breakLabel`
 * têm default no backend) — `breakLabel` é `string | undefined` aqui e
 * `string | null` na resposta.
 */
export interface BlindLevelInput extends Pick<
  BlindLevelDto,
  'levelNumber' | 'smallBlind' | 'bigBlind' | 'durationSeconds'
> {
  ante?: number;
  isBreak?: boolean;
  /** Obrigatório quando `isBreak` — validado no backend. */
  breakLabel?: string;
}

/**
 * Corpo de `POST /blind-structures` e de `PUT /blind-structures/:id` (ADMIN).
 * O mesmo tipo serve aos dois porque o PUT substitui a grade inteira.
 */
export interface CreateBlindStructureRequest {
  name: string;
  /** `levelNumber` sequencial de 1 a N, sem buracos. */
  levels: BlindLevelInput[];
}

/** Corpo de `PATCH /tournaments/:id/blind-levels/:levelNumber` (ADMIN). Parcial. */
export interface UpdateBlindLevelRequest {
  smallBlind?: number;
  bigBlind?: number;
  ante?: number;
  durationSeconds?: number;
}
