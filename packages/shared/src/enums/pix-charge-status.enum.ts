/**
 * Status de uma cobrança PIX (depósito / cash-in) emitida junto ao PSP.
 *
 * - PENDING: QR Code gerado, aguardando pagamento do jogador.
 * - PAID: pagamento confirmado pelo provedor via webhook. É a ÚNICA transição
 *   que credita a Wallet, e o crédito deve ocorrer na mesma transação de banco
 *   que muda o status para PAID (guardado por chave de idempotência do webhook,
 *   pois o PSP pode reentregar a mesma notificação várias vezes).
 * - EXPIRED: o prazo (`expiresAt`) venceu sem pagamento. Nenhum crédito.
 * - CANCELLED: cancelada pelo jogador ou pelo backoffice antes do pagamento.
 *
 * PAID, EXPIRED e CANCELLED são estados terminais.
 */
export enum PixChargeStatus {
  PENDING = 'PENDING',
  PAID = 'PAID',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
}
