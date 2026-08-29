/**
 * Estado operacional de um clube (o tenant).
 *
 * - ACTIVE: opera normalmente.
 * - SUSPENDED: bloqueio temporário. Mesas, torneios e carteiras continuam
 *   existindo (a trilha financeira é intocável), mas o clube não aceita
 *   operação enquanto durar a suspensão.
 * - CANCELLED: encerramento. Terminal, e ainda assim NÃO é delete — pelo mesmo
 *   motivo do `isActive` de `User`: apagar o clube destruiria o histórico
 *   financeiro de todo mundo que jogou nele.
 *
 * Espelha 1:1 (mesmos literais, mesma ordem) `ClubeStatus` do schema Prisma.
 */
export enum ClubeStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  CANCELLED = 'CANCELLED',
}
