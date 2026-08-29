import { ClubeMembershipStatus, ClubeRole } from '@prisma/client';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';

/**
 * Convite/atribuição de papel de um membro do clube.
 *
 * É upsert (não create) porque `(clubeId, userId)` é único: promover um PLAYER
 * a CASHIER é `UPDATE` do mesmo vínculo, não uma segunda linha (ver
 * club.prisma). Por isso a mesma rota cria e altera.
 */
export class UpsertClubeMembershipDto {
  /** Usuário a vincular. Já precisa existir — não há convite por e-mail nesta fase. */
  @IsUUID()
  userId!: string;

  @IsEnum(ClubeRole)
  role!: ClubeRole;

  /**
   * Omitido = `ACTIVE`. `REVOKED` é o desligamento do membro — não existe
   * DELETE de vínculo, para não apagar a explicação de por que aquele usuário
   * aparece na trilha de auditoria do clube.
   */
  @IsOptional()
  @IsEnum(ClubeMembershipStatus)
  status?: ClubeMembershipStatus;
}
