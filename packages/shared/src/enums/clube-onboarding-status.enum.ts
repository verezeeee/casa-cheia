/**
 * Ciclo de vida do onboarding da conta de recebimento do clube no gateway de
 * pagamento (ADR-0002).
 *
 * - PENDING: conta criada no gateway, documentação ainda não submetida.
 * - IN_REVIEW: em análise pelo gateway.
 * - APPROVED: habilitada a receber. É o ÚNICO estado que permite ao clube
 *   receber via split — sem ele, o clube existe mas não opera financeiramente.
 * - REJECTED: recusada pelo gateway.
 *
 * Espelha 1:1 (mesmos literais, mesma ordem) `ClubeOnboardingStatus` do schema
 * Prisma.
 */
export enum ClubeOnboardingStatus {
  PENDING = 'PENDING',
  IN_REVIEW = 'IN_REVIEW',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}
