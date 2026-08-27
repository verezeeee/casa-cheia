/**
 * Situação do vínculo entre um usuário e um clube.
 *
 * - ACTIVE: vínculo vigente; o papel (`ClubeRole`) vale.
 * - REVOKED: desligado do clube. Preferido a DELETE do vínculo, que apagaria a
 *   explicação de por que aquele usuário aparece na trilha de auditoria
 *   financeira do clube.
 *
 * Espelha 1:1 (mesmos literais, mesma ordem) `ClubeMembershipStatus` do schema
 * Prisma.
 */
export enum ClubeMembershipStatus {
  ACTIVE = 'ACTIVE',
  REVOKED = 'REVOKED',
}
