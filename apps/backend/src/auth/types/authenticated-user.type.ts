/**
 * Identidade extraída do access token verificado, anexada a `request.user`
 * pelo `JwtAuthGuard`. Deliberadamente enxuta (id/email/role) — é o que as
 * claims do JWT carregam, nada além disso. Dados mais frescos (nome,
 * isActive, saldo) exigem uma leitura ao banco (ver `AuthService.me`), nunca
 * confiar apenas no token para isso.
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  /** String, não o enum do Prisma — mesma razão de `JwtPayload.role` (ver `auth/types/jwt-payload.type.ts`). */
  role: string;
}
