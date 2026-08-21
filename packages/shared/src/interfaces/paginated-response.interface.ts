/**
 * Envelope genérico de paginação por cursor (keyset pagination).
 *
 * Escolhemos cursor em vez de `offset/limit` porque as listagens do sistema
 * (extrato da wallet, lobby de mesas) recebem inserções constantes: com offset
 * um item novo desloca a janela e o cliente veria registros duplicados ou
 * pulados. O cursor aponta para uma posição estável do índice.
 *
 * `nextCursor` é `null` quando não há mais páginas — o cliente deve testar
 * exatamente isso, e não `items.length < pageSize`.
 */
export interface PaginatedResponse<T> {
  items: T[];

  /** Cursor opaco da próxima página; `null` quando a lista acabou. */
  nextCursor: string | null;
}
