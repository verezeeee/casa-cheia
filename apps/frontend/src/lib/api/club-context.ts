import type { ClubeSummaryDto } from '@poker-system/shared';
import { httpClient } from '../http-client';
import type { CreateClubeRequest, JoinClubeRequest } from './types';

/**
 * Clube "atual" da sessão. Guardado em memória, no mesmo espírito do access
 * token (`http-client.ts`) — é o que todo `getCurrentClubeId()` (chamado de
 * dentro dos módulos `wallet.ts`/`table.ts`/`tournament.ts`, fora de
 * qualquer componente React) lê de forma síncrona. `SessionProvider` é quem
 * decide o valor (via `resolveClubes`) e replica pro próprio estado React —
 * ver docblock lá para a lógica de qual clube vira o "atual" quando o
 * usuário pertence a mais de um.
 */
let currentClubeId: string | null = null;

export function setCurrentClubeId(clubeId: string | null): void {
  currentClubeId = clubeId;
}

/** Lançado se chamado antes da sessão resolver um clube (ver `SessionProvider`). */
export function getCurrentClubeId(): string {
  if (!currentClubeId) {
    throw new Error('Nenhum clube ativo na sessão.');
  }
  return currentClubeId;
}

function listMyClubes(): Promise<ClubeSummaryDto[]> {
  return httpClient.get<ClubeSummaryDto[]>('/clubes');
}

/** Cria um clube; o chamador vira ADMIN dele na hora. */
function createClube(input: CreateClubeRequest): Promise<ClubeSummaryDto> {
  return httpClient.post<ClubeSummaryDto>('/clubes', input);
}

/** Entra num clube existente pelo código de 6 dígitos; ingresso imediato como PLAYER. */
function joinClube(input: JoinClubeRequest): Promise<ClubeSummaryDto> {
  return httpClient.post<ClubeSummaryDto>('/clubes/entrar', input);
}

export const clubApi = { listMyClubes, createClube, joinClube };
