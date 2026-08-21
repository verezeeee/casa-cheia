import { AbacatePayInvalidAmountError } from './errors';

/** "10" | "10.5" | "10.50" — positivo, no máximo 2 casas decimais. */
const DECIMAL_PATTERN = /^\d+(\.\d{1,2})?$/;
const INTEGER_PATTERN = /^-?\d+$/;

/**
 * Converte a string decimal do domínio em centavos inteiros (formato aceito
 * pelo gateway).
 *
 * A conversão é feita por MANIPULAÇÃO DE STRING, nunca por
 * `Math.round(Number(x) * 100)`: o segundo caminho erra em casos como
 * `1.005 * 100 = 100.49999999999999`. Aqui, "125.5" -> "12550" -> 12550.
 *
 * TODO: ajustar caso a doc oficial do AbacatePay passe a aceitar decimal.
 */
export function decimalStringToCents(
  amount: string,
  operation?: string,
): number {
  if (typeof amount !== 'string' || !DECIMAL_PATTERN.test(amount.trim())) {
    throw new AbacatePayInvalidAmountError(
      `Valor monetário inválido: esperado string decimal positiva com até 2 casas (ex: "125.50"), recebido "${String(amount)}".`,
      operation,
    );
  }

  const [integerPart, fractionPart = ''] = amount.trim().split('.');
  const cents = Number(`${integerPart}${fractionPart.padEnd(2, '0')}`);

  if (!Number.isSafeInteger(cents) || cents <= 0) {
    throw new AbacatePayInvalidAmountError(
      `Valor monetário fora do intervalo suportado: "${amount}".`,
      operation,
    );
  }

  return cents;
}

/**
 * Converte centavos inteiros (number ou string numérica, conforme o gateway
 * serializa) de volta para a string decimal do domínio. Também por string:
 * `cents / 100` reintroduziria erro binário.
 */
export function centsToDecimalString(
  cents: number | string,
  operation?: string,
): string {
  const normalized = String(cents).trim();

  if (!INTEGER_PATTERN.test(normalized)) {
    throw new AbacatePayInvalidAmountError(
      `Valor em centavos inválido devolvido pelo gateway: "${normalized}".`,
      operation,
    );
  }

  const negative = normalized.startsWith('-');
  const digits = (negative ? normalized.slice(1) : normalized).padStart(3, '0');

  return `${negative ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}
