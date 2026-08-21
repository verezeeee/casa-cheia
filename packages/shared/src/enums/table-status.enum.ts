/**
 * Status operacional de uma mesa.
 *
 * - OPEN: aceita novos assentos (buy-in) e mãos em andamento.
 * - PAUSED: mesa suspensa temporariamente. Não aceita novos buy-ins; os
 *   stacks dos jogadores sentados permanecem intactos na mesa.
 * - CLOSED: mesa encerrada. Nenhum stack pode permanecer na mesa — todo saldo
 *   remanescente deve ter sido devolvido à Wallet via cash-out antes do
 *   fechamento.
 */
export enum TableStatus {
  OPEN = 'OPEN',
  PAUSED = 'PAUSED',
  CLOSED = 'CLOSED',
}
