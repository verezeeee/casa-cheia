/**
 * Identidade extraída do access token verificado, anexada a `request.user`
 * pelo `JwtAuthGuard`. Deliberadamente enxuta (id/email) — é o que as claims
 * do JWT carregam, nada além disso. Dados mais frescos (nome, isActive, saldo)
 * exigem uma leitura ao banco (ver `AuthService.me`), nunca confiar apenas no
 * token para isso.
 *
 * NÃO tem `role` (CL-BE-03): quem é o usuário e o que ele pode fazer são
 * perguntas diferentes. A segunda depende do clube da requisição e é
 * respondida por `request.clube` (ver `ClubeMembershipGuard`).
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
}
