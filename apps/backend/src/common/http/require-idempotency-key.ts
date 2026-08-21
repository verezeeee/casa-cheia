import { BadRequestException } from '@nestjs/common';

/**
 * `Idempotency-Key` é obrigatório em toda operação financeira que dispara
 * efeito colateral externo (decisão D-04 de `base.prisma`): depósito, saque,
 * buy-in, cash-out, inscrição em torneio. Compartilhado por
 * Wallet/Table/Tournament — antes era uma cópia idêntica por controller.
 */
export function requireIdempotencyKey(
  value: string | undefined,
): asserts value is string {
  if (!value || value.trim().length === 0) {
    throw new BadRequestException('Header Idempotency-Key é obrigatório.');
  }
}
