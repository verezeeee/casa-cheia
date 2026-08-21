import { TableStatus } from '../enums/table-status.enum';
import { TableType } from '../enums/table-type.enum';
import { MoneyString } from '../types/money';

/**
 * Resumo de uma mesa para as listagens do lobby.
 *
 * Todos os limites monetários são strings decimais: o cliente apenas exibe
 * e valida o buy-in comparando via lib decimal / no backend, nunca com
 * aritmética de `number`.
 */
export interface TableSummaryDto {
  id: string;

  name: string;

  type: TableType;

  smallBlind: MoneyString;

  bigBlind: MoneyString;

  /** Buy-in mínimo aceito para sentar na mesa. */
  minBuyIn: MoneyString;

  /** Buy-in máximo aceito para sentar na mesa. */
  maxBuyIn: MoneyString;

  /** Capacidade total de assentos. */
  maxSeats: number;

  /** Assentos atualmente ocupados (`0 <= occupiedSeats <= maxSeats`). */
  occupiedSeats: number;

  status: TableStatus;
}
