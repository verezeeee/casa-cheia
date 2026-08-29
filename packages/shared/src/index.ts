export * from './enums/wallet-transaction-type.enum';
export * from './enums/table-type.enum';
export * from './interfaces/api-error-response.interface';
export * from './interfaces/health-check-response.interface';

// --- W1 / T-SH-01 ---------------------------------------------------------
// Enums de estado (espelham 1:1 os enums do schema Prisma).
export * from './enums/wallet-transaction-status.enum';
export * from './enums/pix-charge-status.enum';
export * from './enums/pix-withdrawal-status.enum';
export * from './enums/table-status.enum';
export * from './enums/table-session-status.enum';
export * from './enums/tournament-status.enum';
export * from './enums/tournament-entry-status.enum';

// Tipos utilitários.
export * from './types/money';

// Contratos de API (auth, wallet, PIX, mesas, torneios, paginação).
export * from './interfaces/auth-tokens-response.interface';
export * from './interfaces/session-user.interface';
export * from './interfaces/wallet-balance-response.interface';
export * from './interfaces/wallet-transaction.dto';
export * from './interfaces/pix-charge-response.interface';
export * from './interfaces/pix-withdrawal-response.interface';
export * from './interfaces/table-summary.dto';
export * from './interfaces/table-seat.dto';
export * from './interfaces/tournament-summary.dto';
export * from './interfaces/tournament-entry.dto';
export * from './interfaces/tournament-detail-response.interface';
export * from './interfaces/paginated-response.interface';

// --- MT / Mesas de Torneio ------------------------------------------------
// Enums espelham 1:1 (mesmos literais, mesma ordem) os enums de `base.prisma`.
export * from './enums/tournament-clock-status.enum';
export * from './enums/tournament-table-status.enum';
export * from './enums/tournament-seat-reason.enum';

// Estrutura de blinds (preset) e relógio.
export * from './interfaces/blind-level.dto';
export * from './interfaces/blind-structure.dto';
export * from './interfaces/tournament-clock.dto';

// Mapa de mesas do torneio.
export * from './interfaces/tournament-seat.dto';
export * from './interfaces/tournament-table.dto';
export * from './interfaces/tournament-table-map.dto';

// --- CL / Multi-tenant "Clube" --------------------------------------------
// Enums espelham 1:1 (mesmos literais, mesma ordem) os enums de `base.prisma`.
// `ClubeRole` SUBSTITUI o antigo `UserRole`, removido nesta onda: papel é
// propriedade do vínculo usuário↔clube, não do usuário (ver ADR-0001).
export * from './enums/clube-status.enum';
export * from './enums/clube-role.enum';
export * from './enums/clube-membership-status.enum';
export * from './enums/clube-onboarding-status.enum';

// Contratos de leitura de clube e de membros (CL-BE-02).
export * from './interfaces/clube-summary.dto';
export * from './interfaces/clube-membership.dto';
