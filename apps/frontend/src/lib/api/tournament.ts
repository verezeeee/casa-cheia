import type {
  PaginatedResponse,
  TournamentDetailResponse,
  TournamentEntryDto,
  TournamentSummaryDto,
} from '@poker-system/shared';
import { httpClient } from '../http-client';
import type { CreateTournamentRequest, EliminateEntryRequest } from './types';

const TOURNAMENT_PATHS = {
  base: '/tournaments',
  detail: (id: string) => `/tournaments/${id}`,
  register: (id: string) => `/tournaments/${id}/register`,
  eliminate: (id: string, entryId: string) => `/tournaments/${id}/entries/${entryId}/eliminate`,
  finish: (id: string) => `/tournaments/${id}/finish`,
} as const;

export function listTournaments(cursor?: string): Promise<PaginatedResponse<TournamentSummaryDto>> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return httpClient.get<PaginatedResponse<TournamentSummaryDto>>(
    `${TOURNAMENT_PATHS.base}${query}`,
  );
}

/** ADMIN. */
export function createTournament(input: CreateTournamentRequest): Promise<TournamentSummaryDto> {
  return httpClient.post<TournamentSummaryDto>(TOURNAMENT_PATHS.base, input);
}

export function getTournament(id: string): Promise<TournamentDetailResponse> {
  return httpClient.get<TournamentDetailResponse>(TOURNAMENT_PATHS.detail(id));
}

export function registerEntry(id: string, idempotencyKey: string): Promise<TournamentEntryDto> {
  return httpClient.post<TournamentEntryDto>(TOURNAMENT_PATHS.register(id), undefined, {
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

export const tournamentApi = {
  listTournaments,
  createTournament,
  getTournament,
  registerEntry,
  eliminateEntry,
  finishTournament,
};
