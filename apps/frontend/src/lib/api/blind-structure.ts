import type { BlindStructureDto } from '@poker-system/shared';
import { httpClient } from '../http-client';
import { getCurrentClubeId } from './club-context';
import type { CreateBlindStructureRequest } from './types';

/**
 * Presets de blinds (`blind-structures.controller.ts`). Prefixo próprio, e não
 * `/torneios/blind-structures`: lá o `@Get(':id')` é catch-all.
 *
 * Leitura vale para qualquer usuário autenticado; mutação é ADMIN.
 */
function base(): string {
  return `/clubes/${getCurrentClubeId()}/blind-structures`;
}

const BLIND_STRUCTURE_PATHS = {
  detail: (id: string) => `${base()}/${id}`,
} as const;

/** ADMIN. */
export function createBlindStructure(
  input: CreateBlindStructureRequest,
): Promise<BlindStructureDto> {
  return httpClient.post<BlindStructureDto>(base(), input);
}

/** Lista completa — o catálogo é pequeno e o backend não pagina esta rota. */
export function listBlindStructures(): Promise<BlindStructureDto[]> {
  return httpClient.get<BlindStructureDto[]>(base());
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
