import { MoneyString } from '../types/money';

/**
 * Saldo atual da carteira virtual do usuário autenticado.
 *
 * `version` é o contador de bloqueio otimista da wallet: ele é incrementado
 * a cada movimentação persistida. O cliente devolve essa versão em operações
 * sensíveis (buy-in, saque) para que o backend rejeite a escrita se o saldo
 * mudou no intervalo, evitando double-spending por requisições concorrentes.
 * A garantia definitiva continua sendo a trava/constraint no banco — a versão
 * é a primeira barreira, não a única.
 */
export interface WalletBalanceResponse {
  /** Saldo disponível, decimal como string. Nunca `number`. */
  balance: MoneyString;

  /** Versão para controle de concorrência otimista. */
  version: number;
}
