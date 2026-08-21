import { timingSafeEqual } from './timing-safe-equal';

describe('timingSafeEqual', () => {
  it('retorna true para strings iguais', () => {
    expect(
      timingSafeEqual('assinatura-hmac-abc123', 'assinatura-hmac-abc123'),
    ).toBe(true);
  });

  it('retorna false para strings diferentes do mesmo tamanho', () => {
    expect(timingSafeEqual('abcdef', 'abcdeg')).toBe(false);
    expect(timingSafeEqual('abcdef', 'zbcdef')).toBe(false);
  });

  it('retorna false para strings de tamanhos diferentes, sem lançar', () => {
    expect(() => timingSafeEqual('abc', 'abcdef')).not.toThrow();
    expect(timingSafeEqual('abc', 'abcdef')).toBe(false);
    expect(timingSafeEqual('abcdef', 'abc')).toBe(false);
    expect(timingSafeEqual('', 'a')).toBe(false);
    expect(timingSafeEqual('a', '')).toBe(false);
  });

  it('retorna true ao comparar duas strings vazias', () => {
    expect(timingSafeEqual('', '')).toBe(true);
  });

  it('é case-sensitive e sensível a espaços', () => {
    expect(timingSafeEqual('Token', 'token')).toBe(false);
    expect(timingSafeEqual('token ', 'token')).toBe(false);
  });

  it('é simétrico', () => {
    const a = 'sha256=deadbeef';
    const b = 'sha256=deadbeee';

    expect(timingSafeEqual(a, b)).toBe(timingSafeEqual(b, a));
    expect(timingSafeEqual(a, a)).toBe(timingSafeEqual(a, a));
  });

  it('lida com strings longas e multibyte', () => {
    const long = 'x'.repeat(10_000);

    expect(timingSafeEqual(long, long)).toBe(true);
    expect(timingSafeEqual(long, `${long}x`)).toBe(false);
    expect(timingSafeEqual('ação', 'ação')).toBe(true);
    expect(timingSafeEqual('ação', 'acao')).toBe(false);
  });
});
