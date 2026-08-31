import { SetMetadata } from '@nestjs/common';
import type { ClubeRole } from '../../generated/prisma';

export const ROLES_KEY = 'roles';

/**
 * Marca uma rota como restrita aos papéis informados DENTRO DO CLUBE da
 * requisição. Exige `ClubeMembershipGuard` antes do `RolesGuard` na cadeia —
 * é ele quem resolve o papel a partir do `:clubeId` da rota.
 */
export const Roles = (...roles: ClubeRole[]) => SetMetadata(ROLES_KEY, roles);
