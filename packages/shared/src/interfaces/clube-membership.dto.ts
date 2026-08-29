import { ClubeMembershipStatus } from '../enums/clube-membership-status.enum';
import { ClubeRole } from '../enums/clube-role.enum';

/**
 * Vínculo usuário↔clube, como exibido na administração de membros do clube.
 *
 * Inclui os vínculos `REVOKED`: desligamento não é DELETE, e a tela de membros
 * precisa mostrar quem já foi da casa (trilha de auditoria).
 */
export interface ClubeMembershipDto {
  id: string;

  userId: string;

  name: string;

  email: string;

  role: ClubeRole;

  status: ClubeMembershipStatus;

  /** ISO-8601. */
  createdAt: string;
}
