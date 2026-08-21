/**
 * Valor monetário decimal serializado como string (ex.: `'1250.00'`, `'0.50'`).
 *
 * REGRA DE OURO DO PROJETO: dinheiro NUNCA trafega como `number`.
 * `number` em JS é IEEE-754 de dupla precisão e não representa decimais
 * exatamente (`0.1 + 0.2 === 0.30000000000000004`), o que em uma carteira
 * virtual vira divergência de centavos e quebra de conciliação.
 *
 * Contrato:
 * - Backend: usa `Prisma.Decimal` (coluna `NUMERIC/DECIMAL`) internamente e
 *   serializa para string na borda HTTP (`.toFixed(2)` / `.toString()`).
 *   Toda aritmética de saldo acontece no banco/Decimal, dentro de transação.
 * - Frontend: trata como opaco. Só FORMATA para exibição (ex.:
 *   `Intl.NumberFormat`) — jamais soma, subtrai ou compara com `Number(...)`.
 *   Se precisar de aritmética no cliente, use uma lib decimal explícita.
 *
 * Formato esperado: casas decimais fixas conforme a moeda (BRL => 2),
 * ponto como separador decimal, sem separador de milhar e sem símbolo.
 */
export type MoneyString = string;
