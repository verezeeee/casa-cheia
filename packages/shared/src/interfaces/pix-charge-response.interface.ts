import { PixChargeStatus } from '../enums/pix-charge-status.enum';
import { MoneyString } from '../types/money';

/**
 * Cobrança PIX de depósito retornada ao cliente após a criação junto ao PSP.
 *
 * A Wallet só é creditada quando o webhook do provedor confirmar o pagamento
 * (`PixChargeStatus.PAID`). O frontend deve tratar esta resposta como
 * "aguardando pagamento" e nunca antecipar saldo a partir dela.
 */
export interface PixChargeResponse {
  id: string;

  /** Valor a ser pago, decimal como string. */
  amount: MoneyString;

  status: PixChargeStatus;

  /** Payload copia-e-cola do PIX (BR Code / EMV). */
  qrCodePayload: string;

  /** URL da imagem do QR Code, quando o provedor a fornecer. */
  qrCodeImageUrl: string | null;

  /** Expiração da cobrança em ISO 8601 UTC. */
  expiresAt: string;
}
