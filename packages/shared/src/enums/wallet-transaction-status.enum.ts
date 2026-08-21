/**
 * Ciclo de vida de uma movimentação da carteira virtual (Wallet).
 *
 * - PENDING: a intenção foi registrada mas o saldo ainda NÃO foi afetado de
 *   forma definitiva (ex.: depósito PIX aguardando confirmação do provedor).
 * - COMPLETED: o saldo já foi debitado/creditado dentro da mesma transação
 *   de banco que gravou o `balanceAfter`. Estado terminal do caminho feliz.
 * - FAILED: a movimentação não se concretizou e nenhum saldo foi alterado
 *   (ex.: cobrança PIX expirada, rejeição do provedor de saque).
 * - REVERSED: a movimentação chegou a afetar o saldo e foi estornada por um
 *   lançamento compensatório. O registro original NUNCA é apagado nem editado
 *   no valor — o razão da wallet é append-only para permitir auditoria.
 *
 * A transição de estado deve ser idempotente: reprocessar o mesmo webhook /
 * mesma chave de idempotência não pode gerar um segundo crédito/débito.
 */
export enum WalletTransactionStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  REVERSED = 'REVERSED',
}
