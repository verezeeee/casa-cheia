import type {
  PaginatedResponse,
  PublicTournamentTableMapDto,
  TournamentClockDto,
  TournamentDetailResponse,
  TournamentEntryDto,
  TournamentSummaryDto,
  TournamentTableMapDto,
} from '@poker-system/shared';
import { httpClient } from '../http-client';
import { getCurrentClubeId } from './club-context';
import type {
  CreateTournamentRequest,
  EliminateEntryRequest,
  RegisterEntryRequest,
  UpdateBlindLevelRequest,
} from './types';

function base(): string {
  return `/clubes/${getCurrentClubeId()}/torneios`;
}

const TOURNAMENT_PATHS = {
  detail: (id: string) => `${base()}/${id}`,
  register: (id: string) => `${base()}/${id}/register`,
  eliminate: (id: string, entryId: string) => `${base()}/${id}/entries/${entryId}/eliminate`,
  finish: (id: string) => `${base()}/${id}/finish`,
  redraw: (id: string) => `${base()}/${id}/redraw`,
  clock: (id: string, action: ClockAction) => `${base()}/${id}/clock/${action}`,
  blindLevel: (id: string, levelNumber: number) => `${base()}/${id}/blind-levels/${levelNumber}`,
  /**
   * Leituras PÚBLICAS (`tournament-display.controller.ts`): são os ÚNICOS GETs
   * de relógio e de mapa de mesas do backend — não existe par autenticado sob
   * `/tournaments/:id/...` (`@Get(':id')` é catch-all lá). O staff consome as
   * mesmas rotas; a diferença é só o payload de mesas, que vem sem `userId`.
   */
  displayClock: (id: string) => `/display/tournaments/${id}/clock`,
  displayTables: (id: string) => `/display/tournaments/${id}/tables`,
} as const;

type ClockAction = 'start' | 'pause' | 'resume' | 'next' | 'previous';

export function listTournaments(cursor?: string): Promise<PaginatedResponse<TournamentSummaryDto>> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return httpClient.get<PaginatedResponse<TournamentSummaryDto>>(`${base()}${query}`);
}

/** ADMIN. */
export function createTournament(input: CreateTournamentRequest): Promise<TournamentSummaryDto> {
  return httpClient.post<TournamentSummaryDto>(base(), input);
}

export function getTournament(id: string): Promise<TournamentDetailResponse> {
  return httpClient.get<TournamentDetailResponse>(TOURNAMENT_PATHS.detail(id));
}

export function registerEntry(
  id: string,
  idempotencyKey: string,
  input: RegisterEntryRequest = {},
): Promise<TournamentEntryDto> {
  // Sem corpo quando não há nada a dizer (contrato de antes do bônus de
  // staff, preservado): só manda `{ staffBonus: true }` quando o jogador
  // realmente optou — o backend trata os dois casos da mesma forma
  // (`dto.staffBonus ?? false`), isto é só para não mandar `"{}"` à toa.
  const body = input.staffBonus === undefined ? undefined : input;
  return httpClient.post<TournamentEntryDto>(TOURNAMENT_PATHS.register(id), body, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

/** ADMIN. */
export function eliminateEntry(
  id: string,
  entryId: string,
  input: EliminateEntryRequest,
): Promise<TournamentEntryDto> {
  return httpClient.post<TournamentEntryDto>(TOURNAMENT_PATHS.eliminate(id, entryId), input);
}

/** ADMIN. */
export function finishTournament(id: string): Promise<TournamentDetailResponse> {
  return httpClient.post<TournamentDetailResponse>(TOURNAMENT_PATHS.finish(id), undefined);
}

/**
 * Estado do relógio. Rota pública: funciona SEM sessão (a TV do salão não faz
 * login) — `httpClient` só anexa `Authorization` quando há token em memória.
 */
export function getClock(id: string): Promise<TournamentClockDto> {
  return httpClient.get<TournamentClockDto>(TOURNAMENT_PATHS.displayClock(id));
}

/** Mapa de mesas. Rota pública, mesmo caso de `getClock`: sem `userId` no payload. */
export function getTableMap(id: string): Promise<PublicTournamentTableMapDto> {
  return httpClient.get<PublicTournamentTableMapDto>(TOURNAMENT_PATHS.displayTables(id));
}

/** ADMIN. Redraw manual — devolve o mapa novo (com `userId`), sem precisar de GET. */
export function redraw(id: string): Promise<TournamentTableMapDto> {
  return httpClient.post<TournamentTableMapDto>(TOURNAMENT_PATHS.redraw(id), undefined);
}

function clockAction(id: string, action: ClockAction): Promise<TournamentClockDto> {
  return httpClient.post<TournamentClockDto>(TOURNAMENT_PATHS.clock(id, action), undefined);
}

/** ADMIN. Todas as mutações do relógio devolvem o `TournamentClockDto` já atualizado. */
export function startClock(id: string): Promise<TournamentClockDto> {
  return clockAction(id, 'start');
}

/** ADMIN. */
export function pauseClock(id: string): Promise<TournamentClockDto> {
  return clockAction(id, 'pause');
}

/** ADMIN. */
export function resumeClock(id: string): Promise<TournamentClockDto> {
  return clockAction(id, 'resume');
}

/** ADMIN. */
export function nextLevel(id: string): Promise<TournamentClockDto> {
  return clockAction(id, 'next');
}

/** ADMIN. Recusado (400) quando já está no nível 1. */
export function previousLevel(id: string): Promise<TournamentClockDto> {
  return clockAction(id, 'previous');
}

/** ADMIN. Edita um nível da grade DESTE torneio (não o preset). */
export function updateBlindLevel(
  id: string,
  levelNumber: number,
  input: UpdateBlindLevelRequest,
): Promise<TournamentClockDto> {
  return httpClient.patch<TournamentClockDto>(TOURNAMENT_PATHS.blindLevel(id, levelNumber), input);
}

export const tournamentApi = {
  listTournaments,
  createTournament,
  getTournament,
  registerEntry,
  eliminateEntry,
  finishTournament,
  getClock,
  getTableMap,
  redraw,
  startClock,
  pauseClock,
  resumeClock,
  nextLevel,
  previousLevel,
  updateBlindLevel,
};
