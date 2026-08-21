import { cn } from './cn';

describe('cn', () => {
  it('junta classes válidas', () => {
    expect(cn('a', 'b')).toBe('a b');
  });

  it('ignora valores falsy', () => {
    expect(cn('a', false, null, undefined, '', 'b')).toBe('a b');
  });

  it('retorna string vazia sem argumentos', () => {
    expect(cn()).toBe('');
  });

  it('preserva a ordem (className externo por último vence no Tailwind)', () => {
    expect(cn('p-2', 'p-4')).toBe('p-2 p-4');
  });
});
