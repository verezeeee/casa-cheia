import {
  FormatError,
  formatDateTime,
  formatDateTimeSafe,
  formatMoney,
  formatMoneySafe,
} from './format';

describe('formatMoney', () => {
  it.each([
    ['0.00', 'R$ 0,00'],
    ['150.00', 'R$ 150,00'],
    ['1234567.89', 'R$ 1.234.567,89'],
    ['0.5', 'R$ 0,50'],
    ['1000', 'R$ 1.000,00'],
  ])('formata %s como %s', (input, expected) => {
    expect(formatMoney(input)).toBe(expected);
  });

  it('formata valores negativos com o sinal antes do símbolo', () => {
    expect(formatMoney('-50.00')).toBe('-R$ 50,00');
    expect(formatMoney('-1234.56')).toBe('-R$ 1.234,56');
  });

  it('normaliza "-0.00" para "R$ 0,00" (sem zero negativo)', () => {
    expect(formatMoney('-0.00')).toBe('R$ 0,00');
  });

  it('não usa espaço não-quebrável na saída', () => {
    expect(formatMoney('10.00')).not.toMatch(/[\u00A0\u202F]/);
  });

  it('aceita espaços em volta do valor', () => {
    expect(formatMoney('  150.00  ')).toBe('R$ 150,00');
  });

  it.each(['', '   ', 'abc', '1.2.3', '1,50', 'R$ 10', '1e3', '+10.00', 'NaN'])(
    'lança FormatError para entrada inválida %p',
    (input) => {
      expect(() => formatMoney(input)).toThrow(FormatError);
    },
  );

  it('lança FormatError para valores não-string em runtime', () => {
    expect(() => formatMoney(undefined as unknown as string)).toThrow(FormatError);
    expect(() => formatMoney(null as unknown as string)).toThrow(FormatError);
  });

  it('lança FormatError para magnitude não representável', () => {
    const overflow = `${'9'.repeat(400)}.00`;
    expect(() => formatMoney(overflow)).toThrow(/fora do intervalo/);
  });
});

describe('formatMoneySafe', () => {
  it('devolve o valor formatado quando válido', () => {
    expect(formatMoneySafe('12.30')).toBe('R$ 12,30');
  });

  it('devolve o fallback padrão quando inválido', () => {
    expect(formatMoneySafe('xxx')).toBe('—');
  });

  it('devolve o fallback customizado quando inválido', () => {
    expect(formatMoneySafe('', '--')).toBe('--');
  });
});

describe('formatDateTime', () => {
  it('formata uma data ISO em pt-BR no fuso de São Paulo', () => {
    expect(formatDateTime('2026-03-15T18:30:00.000Z')).toBe('15/03/2026, 15:30');
  });

  it('converte corretamente quando o UTC vira o dia anterior em São Paulo', () => {
    expect(formatDateTime('2026-01-01T02:00:00.000Z')).toBe('31/12/2025, 23:00');
  });

  it('não depende do fuso do dispositivo (offset explícito na entrada)', () => {
    expect(formatDateTime('2026-03-15T15:30:00-03:00')).toBe('15/03/2026, 15:30');
  });

  it.each(['', '   ', 'não é data', '2026-13-45T99:99:99Z'])(
    'lança FormatError para entrada inválida %p',
    (input) => {
      expect(() => formatDateTime(input)).toThrow(FormatError);
    },
  );

  it('lança FormatError para valores não-string em runtime', () => {
    expect(() => formatDateTime(undefined as unknown as string)).toThrow(FormatError);
  });
});

describe('formatDateTimeSafe', () => {
  it('devolve o valor formatado quando válido', () => {
    expect(formatDateTimeSafe('2026-03-15T18:30:00.000Z')).toBe('15/03/2026, 15:30');
  });

  it('devolve o fallback quando inválido', () => {
    expect(formatDateTimeSafe('nope')).toBe('—');
    expect(formatDateTimeSafe('nope', 'sem data')).toBe('sem data');
  });
});
