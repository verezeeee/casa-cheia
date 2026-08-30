import type { ClubeSummaryDto } from '@poker-system/shared';
import { httpClient } from '../http-client';

/**
 * Clube "atual" da sessão. MVP de clube único (mesmo padrão das fixtures de
 * teste do backend — ver `tournament-helpers.ts`): ainda não existe seletor
 * de clube na UI (CL-FE-01), então a sessão assume o primeiro clube retornado
 * por `GET /clubes`. Guardado em memória, no mesmo espírito do access token
 * (`http-client.ts`) — resolvido uma vez no boot da sessão/login
 * (`SessionProvider`) e limpo no logout.
 */
let currentClubeId: string | null = null;

export function setCurrentClubeId(clubeId: string | null): void {
  currentClubeId = clubeId;
}

/** Lançado se chamado antes da sessão resolver o clube (ver `SessionProvider`). */
export function getCurrentClubeId(): string {
  if (!currentClubeId) {
    throw new Error('Nenhum clube ativo na sessão.');
  }
  return currentClubeId;
}

export function listMyClubes(): Promise<ClubeSummaryDto[]> {
  return httpClient.get<ClubeSummaryDto[]>('/clubes');
}

export const clubApi = { listMyClubes };
