import type { BlindStructureDto } from '@poker-system/shared';
import { httpClient } from '../http-client';
import type { CreateBlindStructureRequest } from './types';

/**
 * Presets de blinds (`blind-structures.controller.ts`). Prefixo próprio, e não
 * `/tournaments/blind-structures`: lá o `@Get(':id')` é catch-all.
 *
 * Leitura vale para qualquer usuário autenticado; mutação é ADMIN.
 */
const BLIND_STRUCTURE_PATHS = {
  base: '/blind-structures',
  detail: (id: string) => `/blind-structures/${id}`,
} as const;

/** ADMIN. */
export function createBlindStructure(
  input: CreateBlindStructureRequest,
): Promise<BlindStructureDto> {
  return httpClient.post<BlindStructureDto>(BLIND_STRUCTURE_PATHS.base, input);
}

/** Lista completa — o catálogo é pequeno e o backend não pagina esta rota. */
export function listBlindStructures(): Promise<BlindStructureDto[]> {
  return httpClient.get<BlindStructureDto[]>(BLIND_STRUCTURE_PATHS.base);
}

export function getBlindStructure(id: string): Promise<BlindStructureDto> {
  return httpClient.get<BlindStructureDto>(BLIND_STRUCTURE_PATHS.detail(id));
}

/** ADMIN. PUT, não PATCH: a grade de níveis é substituída por inteiro. */
export function updateBlindStructure(
  id: string,
  input: CreateBlindStructureRequest,
): Promise<BlindStructureDto> {
  return httpClient.put<BlindStructureDto>(BLIND_STRUCTURE_PATHS.detail(id), input);
}

/** ADMIN. Responde 204 — sem corpo. */
export function deleteBlindStructure(id: string): Promise<void> {
  return httpClient.delete<void>(BLIND_STRUCTURE_PATHS.detail(id));
}

export const blindStructureApi = {
  createBlindStructure,
  listBlindStructures,
  getBlindStructure,
  updateBlindStructure,
  deleteBlindStructure,
};
