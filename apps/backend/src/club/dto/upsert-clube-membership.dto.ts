import { ClubeMembershipStatus, ClubeRole } from '../../generated/prisma';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Atribuição de papel de um membro do clube — atualiza um vínculo existente
 * OU cria um usuário novo, mutuamente exclusivos (validado no service,
 * `ClubService.upsertMember`, porque XOR entre campos não se expressa em
 * decorators de classe isolados):
 *
 * - `{ userId, role }`: vincula alguém que JÁ TEM conta (papel de
 *   `ClubeMembership` para um `User` existente). É upsert, não create,
 *   porque `(clubeId, userId)` é único: promover um PLAYER a CASHIER é
 *   `UPDATE` do mesmo vínculo, não uma segunda linha (ver club.prisma).
 * - `{ email, name, role }`: CADASTRA um usuário novo (o admin registrando
 *   alguém que nunca se autocadastrou — útil no balcão físico do clube, sem
 *   depender de e-mail de convite, que este projeto não envia). A senha é
 *   gerada pelo servidor e devolvida uma única vez na resposta
 *   (`ClubeMembershipDto.temporaryPassword`).
 */
export class UpsertClubeMembershipDto {
  /** Usuário JÁ EXISTENTE a vincular. Exclusivo com `email`/`name`. */
  @IsOptional()
  @IsUUID()
  userId?: string;

  /** E-mail do usuário NOVO a cadastrar. Exclusivo com `userId`; exige `name` junto. */
  @IsOptional()
  @IsEmail()
  email?: string;

  /** Nome do usuário NOVO a cadastrar. Exclusivo com `userId`; exige `email` junto. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

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
