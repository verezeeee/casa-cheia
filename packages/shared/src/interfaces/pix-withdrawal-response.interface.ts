import { PixWithdrawalStatus } from '../enums/pix-withdrawal-status.enum';
import { MoneyString } from '../types/money';

/**
 * Saque PIX solicitado, devolvido ao cliente após o débito da carteira.
 *
 * O débito já ocorreu no momento da solicitação (`PixWithdrawalStatus`
 * documenta o porquê) — o frontend deve refletir o novo saldo imediatamente,
 * sem esperar `status` chegar a `COMPLETED`.
 */
export interface PixWithdrawalResponse {
  id: string;

  /** Valor solicitado, decimal como string. */
  amount: MoneyString;

  status: PixWithdrawalStatus;

  /** Últimos 4 dígitos/caracteres da chave PIX, para confirmação visual — nunca a chave completa (dado sensível). */
  pixKeyMasked: string;

  /** Motivo da falha, apenas quando `status === 'FAILED'`. */
  failureReason: string | null;

  /** Data/hora de criação em ISO 8601 UTC. */
  createdAt: string;
}
