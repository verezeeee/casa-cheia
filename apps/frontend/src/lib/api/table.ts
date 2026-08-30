import type { PaginatedResponse, TableSeatDto, TableSummaryDto } from '@poker-system/shared';
import { httpClient } from '../http-client';
import { getCurrentClubeId } from './club-context';
import type { CreateTableRequest, RecordMovementRequest, SitAtTableRequest } from './types';

function base(): string {
  return `/clubes/${getCurrentClubeId()}/mesas`;
}

const TABLE_PATHS = {
  seats: (tableId: string) => `${base()}/${tableId}/seats`,
  sit: (tableId: string) => `${base()}/${tableId}/sit`,
  cashOut: (tableId: string, sessionId: string) =>
    `${base()}/${tableId}/sessions/${sessionId}/cash-out`,
  movements: (tableId: string, sessionId: string) =>
    `${base()}/${tableId}/sessions/${sessionId}/movements`,
  close: (tableId: string) => `${base()}/${tableId}/close`,
} as const;

export function listTables(cursor?: string): Promise<PaginatedResponse<TableSummaryDto>> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return httpClient.get<PaginatedResponse<TableSummaryDto>>(`${base()}${query}`);
}

/** ADMIN. */
export function createTable(input: CreateTableRequest): Promise<TableSummaryDto> {
  return httpClient.post<TableSummaryDto>(base(), input);
}

export function getSeats(tableId: string): Promise<TableSeatDto[]> {
  return httpClient.get<TableSeatDto[]>(TABLE_PATHS.seats(tableId));
}

export function sitAtTable(
  tableId: string,
  input: SitAtTableRequest,
  idempotencyKey: string,
): Promise<TableSeatDto> {
  return httpClient.post<TableSeatDto>(TABLE_PATHS.sit(tableId), input, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

export function cashOut(
  tableId: string,
  sessionId: string,
  idempotencyKey: string,
): Promise<TableSeatDto> {
  return httpClient.post<TableSeatDto>(TABLE_PATHS.cashOut(tableId, sessionId), undefined, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

/** ADMIN. */
export function recordMovement(
  tableId: string,
  sessionId: string,
  input: RecordMovementRequest,
): Promise<TableSeatDto> {
  return httpClient.post<TableSeatDto>(TABLE_PATHS.movements(tableId, sessionId), input);
}

/** ADMIN. Faz cash-out de todo mundo sentado e fecha a mesa. */
export function closeTable(tableId: string): Promise<TableSummaryDto> {
  return httpClient.post<TableSummaryDto>(TABLE_PATHS.close(tableId));
}

export const tableApi = {
  listTables,
  createTable,
  getSeats,
  sitAtTable,
  cashOut,
  recordMovement,
  closeTable,
};
