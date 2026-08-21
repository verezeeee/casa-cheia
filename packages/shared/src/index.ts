export * from './enums/user-role.enum';
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
export * from './interfaces/table-summary.dto';
export * from './interfaces/table-seat.dto';
export * from './interfaces/tournament-summary.dto';
export * from './interfaces/tournament-entry.dto';
export * from './interfaces/paginated-response.interface';
