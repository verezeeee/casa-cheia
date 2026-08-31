import type { ClubeRole } from '../../generated/prisma';

/**
 * Clube da requisição corrente, resolvido pelo `ClubeMembershipGuard` a partir
 * do `:clubeId` da rota e anexado a `request.clube`.
 *
 * `role` é o papel do usuário AUTENTICADO NESTE CLUBE — não um atributo dele.
 * A mesma pessoa pode ser `ADMIN` aqui e `PLAYER` na requisição seguinte, para
 * outro clube.
 */
export interface CurrentClubeContext {
  id: string;
  role: ClubeRole;
}
