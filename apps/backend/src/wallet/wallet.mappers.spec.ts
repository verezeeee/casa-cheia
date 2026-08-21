import { BadRequestException } from '@nestjs/common';
import { decodeCursor, encodeCursor } from './wallet.mappers';

describe('wallet.mappers cursor', () => {
  it('faz round-trip: decodeCursor(encodeCursor(x)) === x', () => {
    const createdAt = new Date('2026-01-15T10:00:00.000Z');
    const cursor = encodeCursor({ createdAt, id: 'txn-42' });

    const decoded = decodeCursor(cursor);

    expect(decoded.id).toBe('txn-42');
    expect(decoded.createdAt.toISOString()).toBe(createdAt.toISOString());
  });

  it('rejeita um cursor que não é base64url de JSON válido', () => {
    expect(() => decodeCursor('não-é-base64-json-válido')).toThrow(
      BadRequestException,
    );
  });

  it('rejeita um cursor cujo JSON não tem o shape esperado (sem id)', () => {
    const malformed = Buffer.from(
      JSON.stringify({ createdAt: '2026-01-15T10:00:00.000Z' }),
    ).toString('base64url');
    expect(() => decodeCursor(malformed)).toThrow(BadRequestException);
  });

  it('rejeita um cursor com createdAt não parseável como data', () => {
    const malformed = Buffer.from(
      JSON.stringify({ createdAt: 'não-é-uma-data', id: 'txn-1' }),
    ).toString('base64url');
    expect(() => decodeCursor(malformed)).toThrow(BadRequestException);
  });
});
