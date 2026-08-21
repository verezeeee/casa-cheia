import { BadRequestException } from '@nestjs/common';
import { requireIdempotencyKey } from './require-idempotency-key';

describe('requireIdempotencyKey', () => {
  it('não lança quando o valor é uma string não vazia', () => {
    expect(() => requireIdempotencyKey('idem-1')).not.toThrow();
  });

  it.each([undefined, '', '   '])(
    'lança BadRequestException para %p',
    (value) => {
      expect(() => requireIdempotencyKey(value)).toThrow(BadRequestException);
    },
  );
});
