/**
 * Formatadores de apresentação (pt-BR).
 *
 * Regra do projeto: valores monetários trafegam como STRING decimal
 * (ex.: "150.00"), espelhando o `Decimal` do banco. Este módulo é
 * exclusivamente de EXIBIÇÃO - nenhuma soma/subtração/comparação aritmética
 * de dinheiro acontece aqui (isso é responsabilidade do backend, em Decimal).
 * A única conversão numérica é a mínima necessária para alimentar o
 * `Intl.NumberFormat` na renderização de um único valor.
 */

/** Erro lançado quando um valor recebido não respeita o contrato esperado. */
export class FormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormatError';
  }
}

/** Fuso fixo: a operação é brasileira, então a exibição não depende do device. */
const TIME_ZONE = 'America/Sao_Paulo';

/** Aceita apenas decimais "puros": opcional sinal, dígitos e casas decimais. */
const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

const moneyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: TIME_ZONE,
});

/**
 * Formata uma string decimal como moeda BRL.
 *
 * Decisão: entrada inválida (vazia, não-numérica, `NaN`) LANÇA `FormatError`
 * em vez de retornar fallback silencioso - um valor monetário corrompido é um
 * bug de contrato com a API e deve aparecer, não ser mascarado por "R$ 0,00".
 * Para UI defensiva, use `formatMoneySafe`.
 *
 * @example formatMoney('1234567.89') // "R$ 1.234.567,89"
 */
export function formatMoney(value: string): string {
  if (typeof value !== 'string' || !DECIMAL_PATTERN.test(value.trim())) {
    throw new FormatError(
      `Valor monetário inválido: ${JSON.stringify(value)}. ` +
        'Esperado uma string decimal (ex.: "150.00").',
    );
  }

  const numeric = Number(value.trim());

  if (!Number.isFinite(numeric)) {
    throw new FormatError(`Valor monetário fora do intervalo representável: ${value}.`);
  }

  // Normaliza -0 ("-0.00") para 0, evitando exibir "-R$ 0,00".
  // O espaço fino não-quebrável do ICU vira espaço comum para manter o texto
  // previsível em buscas/testes e em cópia pelo usuário.
  return moneyFormatter.format(numeric === 0 ? 0 : numeric).replace(/[\u00A0\u202F]/g, ' ');
}

/**
 * Versão tolerante de `formatMoney`: devolve `fallback` em vez de lançar.
 * Útil em listagens onde um registro ruim não deve derrubar a tela inteira.
 */
export function formatMoneySafe(value: string, fallback = '—'): string {
  try {
    return formatMoney(value);
  } catch {
    return fallback;
  }
}

/**
 * Formata uma data ISO 8601 como data + hora em pt-BR (fuso de São Paulo).
 *
 * Decisão: entrada inválida lança `FormatError`, pelo mesmo motivo de
 * `formatMoney` (contrato com a API).
 *
 * @example formatDateTime('2026-03-15T18:30:00.000Z') // "15/03/2026, 15:30"
 */
export function formatDateTime(value: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new FormatError('Data inválida: esperado uma string ISO 8601 não vazia.');
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new FormatError(`Data inválida: ${JSON.stringify(value)}. Esperado ISO 8601.`);
  }

  return dateTimeFormatter.format(date).replace(/[\u00A0\u202F]/g, ' ');
}

/** Versão tolerante de `formatDateTime`. */
export function formatDateTimeSafe(value: string, fallback = '—'): string {
  try {
    return formatDateTime(value);
  } catch {
    return fallback;
  }
}
