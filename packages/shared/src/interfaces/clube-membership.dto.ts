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

  /**
   * Senha temporária gerada pelo servidor — SÓ presente na resposta de
   * `POST .../membros` quando o admin CADASTROU um usuário novo (não veio
   * `userId`, veio `email`+`name`). Nunca persistida em claro, nunca
   * recuperável depois desta resposta: quem cadastrou precisa repassá-la ao
   * jogador (ex.: no balcão) antes de sair da tela.
   */
  temporaryPassword?: string;
}
