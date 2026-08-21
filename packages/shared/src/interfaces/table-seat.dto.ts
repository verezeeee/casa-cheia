import { MoneyString } from '../types/money';

/**
 * Assento de uma mesa, ocupado ou vago.
 *
 * Quando o assento está vago, `userId`, `userName`, `currentStack` e
 * `sessionId` são `null`. `currentStack` é o dinheiro que está NA MESA — ele
 * saiu da Wallet no buy-in e só volta para lá no cash-out; os dois saldos
 * jamais são somados na UI.
 */
export interface TableSeatDto {
  /** Posição do assento na mesa (1-based). */
  seatNumber: number;

  userId: string | null;

  userName: string | null;

  /** Stack do jogador na mesa; `null` se o assento estiver vago. */
  currentStack: MoneyString | null;

  /** Id da `TableSession` — necessário para chamar cash-out/movements deste assento. */
  sessionId: string | null;
}
