import type {
  PaginatedResponse,
  TableCloseResultDto,
  TableSeatDto,
  TableSummaryDto,
} from '@poker-system/shared';
import { httpClient } from '../http-client';
import { getCurrentClubeId } from './club-context';
import type {
  CreateTableRequest,
  RebuyRequest,
  RecordMovementRequest,
  SitAtTableRequest,
  SitGuestAtTableRequest,
} from './types';

function base(): string {
  return `/clubes/${getCurrentClubeId()}/mesas`;
}

const TABLE_PATHS = {
  detail: (tableId: string) => `${base()}/${tableId}`,
  seats: (tableId: string) => `${base()}/${tableId}/seats`,
  sit: (tableId: string) => `${base()}/${tableId}/sit`,
  sitForUser: (tableId: string, userId: string) => `${base()}/${tableId}/sit/${userId}`,
  sitGuest: (tableId: string) => `${base()}/${tableId}/sit-guest`,
  cashOut: (tableId: string, sessionId: string) =>
    `${base()}/${tableId}/sessions/${sessionId}/cash-out`,
  adminCashOut: (tableId: string, sessionId: string) =>
    `${base()}/${tableId}/sessions/${sessionId}/admin-cash-out`,
  rebuy: (tableId: string, sessionId: string) => `${base()}/${tableId}/sessions/${sessionId}/rebuy`,
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

export function getTable(tableId: string): Promise<TableSummaryDto> {
  return httpClient.get<TableSummaryDto>(TABLE_PATHS.detail(tableId));
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

/** ADMIN. Senta outro membro do clube (já cadastrado) — o buy-in sai da carteira dele, não da de quem chama. */
export function sitAtTableForUser(
  tableId: string,
  userId: string,
  input: SitAtTableRequest,
  idempotencyKey: string,
): Promise<TableSeatDto> {
  return httpClient.post<TableSeatDto>(TABLE_PATHS.sitForUser(tableId, userId), input, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

/** ADMIN. Senta um jogador sem cadastro — só nome e telefone. */
export function sitGuestAtTable(
  tableId: string,
  input: SitGuestAtTableRequest,
  idempotencyKey: string,
): Promise<TableSeatDto> {
  return httpClient.post<TableSeatDto>(TABLE_PATHS.sitGuest(tableId), input, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

/** ADMIN. Cash-out da sessão de outro jogador — necessário pra encerrar a sessão de um convidado, que nunca loga. */
export function cashOutAsAdmin(
  tableId: string,
  sessionId: string,
  idempotencyKey: string,
): Promise<TableSeatDto> {
  return httpClient.post<TableSeatDto>(TABLE_PATHS.adminCashOut(tableId, sessionId), undefined, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

/** ADMIN. Novo buy-in numa sessão já sentada — ver docblock de `TableService.rebuy`. */
export function rebuy(
  tableId: string,
  sessionId: string,
  input: RebuyRequest,
  idempotencyKey: string,
): Promise<TableSeatDto> {
  return httpClient.post<TableSeatDto>(TABLE_PATHS.rebuy(tableId, sessionId), input, {
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

/** ADMIN. Faz cash-out de todo mundo sentado, fecha a mesa e devolve o relatório de buy-ins por jogador. */
export function closeTable(tableId: string): Promise<TableCloseResultDto> {
  return httpClient.post<TableCloseResultDto>(TABLE_PATHS.close(tableId));
}

export const tableApi = {
  listTables,
  createTable,
  getTable,
  getSeats,
  sitAtTable,
  sitAtTableForUser,
  sitGuestAtTable,
  cashOut,
  cashOutAsAdmin,
  rebuy,
  recordMovement,
  closeTable,
};
