import { REDACTED, redactSecrets, redactString } from './redact.util';

const SECRET = 'abacatepay_live_SUPERSECRETKEY';

describe('redact.util', () => {
  it('substitui o segredo mesmo embutido em uma string maior', () => {
    expect(redactString(`Bearer ${SECRET} rejeitado`, [SECRET])).toBe(
      `Bearer ${REDACTED} rejeitado`,
    );
  });

  it('redige o valor de chaves sensíveis mesmo sem conhecer o segredo', () => {
    const result = redactSecrets({
      Authorization: 'Bearer qualquer-coisa',
      pixKey: 'jogador@exemplo.com',
      apiKey: 'outra-chave',
      amount: 1000,
    }) as Record<string, unknown>;

    expect(result).toEqual({
      Authorization: REDACTED,
      pixKey: REDACTED,
      apiKey: REDACTED,
      amount: 1000,
    });
  });

  it('percorre objetos e arrays aninhados', () => {
    const result = redactSecrets(
      { errors: [{ detail: `key=${SECRET}` }], ok: true, nulo: null },
      [SECRET],
    );

    expect(result).toEqual({
      errors: [{ detail: `key=${REDACTED}` }],
      ok: true,
      nulo: null,
    });
  });

  it('ignora segredos vazios ou curtos demais (evitaria corromper toda string)', () => {
    expect(redactString('texto qualquer', ['', undefined, null, 'ab'])).toBe(
      'texto qualquer',
    );
  });

  it('trunca strings muito longas', () => {
    const result = redactString('x'.repeat(1000));

    expect(result.length).toBeLessThan(600);
    expect(result.endsWith('[truncado]')).toBe(true);
  });

  it('trunca arrays muito longos', () => {
    const result = redactSecrets(
      Array.from({ length: 30 }, (_, i) => i),
    ) as unknown[];

    expect(result).toHaveLength(21);
    expect(result[20]).toBe('…(+10 itens)');
  });

  it('trunca profundidade excessiva', () => {
    const deep = { a: { b: { c: { d: { e: { f: 'fundo' } } } } } };

    expect(redactSecrets(deep)).toEqual({
      a: { b: { c: { d: { e: '[Truncado]' } } } },
    });
  });

  it('não percorre instâncias de classe — vira string higienizada', () => {
    class Fake {
      constructor(public readonly token: string) {}
      toString(): string {
        return `Fake(${this.token})`;
      }
    }

    expect(redactSecrets(new Fake(SECRET), [SECRET])).toBe(`Fake(${REDACTED})`);
  });

  it('serializa Error sem arrastar propriedades internas (ex: config do axios)', () => {
    const error = Object.assign(new Error(`falhou com ${SECRET}`), {
      config: { headers: { Authorization: `Bearer ${SECRET}` } },
    });

    const result = redactSecrets(error, [SECRET]) as string;

    expect(result).toBe(`Error: falhou com ${REDACTED}`);
    expect(result).not.toContain(SECRET);
  });

  it('usa a tag interna quando a instância não tem toString próprio', () => {
    class Bare {
      readonly a = 1;
    }

    expect(redactSecrets(new Bare())).toBe('[object Object]');
  });

  it('não serializa funções nem valores exóticos', () => {
    expect(redactSecrets(() => SECRET, [SECRET])).toBe('[Function]');
    expect(redactSecrets(10n)).toBe('10');
    expect(redactSecrets(Symbol(SECRET), [SECRET])).toBe(`Symbol(${REDACTED})`);
  });
});
