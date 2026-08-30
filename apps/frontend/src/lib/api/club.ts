import type { ClubeMembershipDto } from '@poker-system/shared';
import { httpClient } from '../http-client';
import { getCurrentClubeId } from './club-context';
import type { UpsertMemberRequest } from './types';

/**
 * Administração de membros do clube atual (`club.controller.ts`). Leitura e
 * escrita são ADMIN — o backend responde 403/404 pra quem não é, o front não
 * duplica a checagem aqui.
 */
function base(): string {
  return `/clubes/${getCurrentClubeId()}/membros`;
}

/** Inclui os vínculos `REVOKED` — trilha de quem já foi da casa. */
export function listMembers(): Promise<ClubeMembershipDto[]> {
  return httpClient.get<ClubeMembershipDto[]>(base());
}

/**
 * Dois modos: `{ userId, role }` vincula alguém que já tem conta; `{ email,
 * name, role }` CADASTRA um usuário novo — a resposta só tem
 * `temporaryPassword` nesse segundo caso (ver `ClubeMembershipDto`).
 */
export function upsertMember(input: UpsertMemberRequest): Promise<ClubeMembershipDto> {
  return httpClient.post<ClubeMembershipDto>(base(), input);
}

export const clubMembersApi = { listMembers, upsertMember };
