import { BadRequestException } from '@nestjs/common';

/**
 * Cursor opaco de `PaginatedResponse<T>` (keyset por `createdAt` + `id`).
 * Usado por qualquer listagem paginada do domínio (extrato da wallet,
 * lobby de mesas, ...) — ver `WalletService.getTransactions` para o
 * primeiro uso e o porquê de keyset em vez de offset/limit.
 */
export interface Cursor {
  createdAt: Date;
  id: string;
}

export function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(
    JSON.stringify({ createdAt: row.createdAt.toISOString(), id: row.id }),
  ).toString('base64url');
}

export function decodeCursor(cursor: string): Cursor {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as {
      createdAt: string;
      id: string;
    };
    const createdAt = new Date(parsed.createdAt);
    if (typeof parsed.id !== 'string' || Number.isNaN(createdAt.getTime())) {
      throw new Error('shape inválido');
    }
    return { createdAt, id: parsed.id };
  } catch {
    throw new BadRequestException('cursor inválido.');
  }
}
