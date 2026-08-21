import { IsIn, Matches } from 'class-validator';

/** Sinal opcional: crédito ao stack (mão ganha) ou débito (mão perdida). */
const SIGNED_DECIMAL_PATTERN = /^-?\d+(\.\d{1,2})?$/;

/**
 * BUY_IN e CASH_OUT têm endpoints dedicados (cruzam a wallet) — este DTO só
 * aceita os motivos que ficam DENTRO da mesa, ver `StackMovementReason` em
 * table.prisma.
 */
const ALLOWED_REASONS = ['HAND_RESULT', 'ADJUSTMENT'] as const;

export class RecordMovementDto {
  @Matches(SIGNED_DECIMAL_PATTERN, {
    message: 'amount deve ser um decimal monetário com sinal, ex: "-25.00".',
  })
  amount!: string;

  @IsIn(ALLOWED_REASONS)
  reason!: (typeof ALLOWED_REASONS)[number];
}
