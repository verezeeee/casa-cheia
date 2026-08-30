import type { EntryHistoryItemDto, PaginatedResponse } from '@poker-system/shared';
import { httpClient } from '../http-client';
import { getCurrentClubeId } from './club-context';

function base(): string {
  return `/clubes/${getCurrentClubeId()}/entradas`;
}

/**
 * ADMIN vê o histórico do clube inteiro; qualquer outro papel só o próprio
 * — a mesma rota decide isso no backend (`EntriesController`), não aqui.
 */
export function listEntries(cursor?: string): Promise<PaginatedResponse<EntryHistoryItemDto>> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return httpClient.get<PaginatedResponse<EntryHistoryItemDto>>(`${base()}${query}`);
}

export const entriesApi = { listEntries };
