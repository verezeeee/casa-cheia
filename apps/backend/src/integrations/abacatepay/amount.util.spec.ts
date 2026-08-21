import { centsToDecimalString, decimalStringToCents } from './amount.util';
import { AbacatePayInvalidAmountError } from './errors';

describe('amount.util', () => {
  describe('decimalStringToCents', () => {
    it.each([
      ['10', 1000],
      ['10.5', 1050],
      ['125.50', 12550],
      ['0.01', 1],
      ['50000.00', 5000000],
      [' 125.50 ', 12550],
    ])('converte "%s" em %i centavos', (input, expected) => {
      expect(decimalStringToCents(input)).toBe(expected);
    });

    it.each([
      ['125.505'],
      ['abc'],
      [''],
      ['-10.00'],
      ['0.00'],
      ['1e3'],
      ['1,50'],
    ])('rejeita "%s"', (input) => {
      expect(() => decimalStringToCents(input)).toThrow(
        AbacatePayInvalidAmountError,
      );
    });

    it('rejeita `number` — dinheiro nunca trafega como IEEE-754', () => {
      expect(() =>
        decimalStringToCents(125.5 as unknown as string, 'createPixCharge'),
      ).toThrow(AbacatePayInvalidAmountError);
    });

    it('rejeita valor acima do inteiro seguro', () => {
      expect(() => decimalStringToCents('99999999999999999.99')).toThrow(
        AbacatePayInvalidAmountError,
      );
    });
  });

  describe('centsToDecimalString', () => {
    it.each([
      [12550, '125.50'],
      ['12550', '125.50'],
      [1, '0.01'],
      [0, '0.00'],
      [100, '1.00'],
      [-2550, '-25.50'],
    ])('converte %s centavos em "%s"', (input, expected) => {
      expect(centsToDecimalString(input)).toBe(expected);
    });

    it('rejeita valor não inteiro devolvido pelo gateway', () => {
      expect(() => centsToDecimalString('12.5')).toThrow(
        AbacatePayInvalidAmountError,
      );
    });

    it.each(['0.07', '19.99', '1000.10', '0.29'])(
      'é o inverso exato de decimalStringToCents para "%s" (sem erro binário)',
      (amount) => {
        expect(centsToDecimalString(decimalStringToCents(amount))).toBe(amount);
      },
    );
  });
});
