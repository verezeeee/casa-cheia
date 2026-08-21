import { Matches } from 'class-validator';

/**
 * Mesmo padrão de `decimalString` em `config/env.validation.ts`: string
 * decimal positiva com até 2 casas. Dinheiro nunca trafega como `number`
 * (ver `packages/shared/src/types/money.ts`).
 */
const DECIMAL_PATTERN = /^\d+(\.\d{1,2})?$/;

export class CreateDepositDto {
  @Matches(DECIMAL_PATTERN, {
    message: 'amount deve ser um decimal em formato monetário, ex: "50.00".',
  })
  amount!: string;
}
