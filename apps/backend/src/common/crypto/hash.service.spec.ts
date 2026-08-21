import { createHash } from 'node:crypto';
import { HashService } from './hash.service';

describe('HashService', () => {
  let service: HashService;

  beforeEach(() => {
    service = new HashService();
  });

  describe('sha256', () => {
    it('é determinístico: o mesmo input sempre produz o mesmo hash', () => {
      const token = 'refresh-token-aleatorio-123';

      expect(service.sha256(token)).toBe(service.sha256(token));
    });

    it('produz hashes diferentes para inputs diferentes', () => {
      expect(service.sha256('token-a')).not.toBe(service.sha256('token-b'));
      // Sensível a mudanças mínimas (efeito avalanche).
      expect(service.sha256('token-a')).not.toBe(service.sha256('token-A'));
    });

    it('retorna 64 caracteres hexadecimais minúsculos', () => {
      const hash = service.sha256('qualquer-valor');

      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('confere com o SHA-256 nativo do Node (vetor conhecido)', () => {
      const expected = createHash('sha256').update('abc', 'utf8').digest('hex');

      expect(service.sha256('abc')).toBe(expected);
      expect(service.sha256('abc')).toBe(
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      );
    });

    it('nunca devolve o valor original em claro', () => {
      const token = 'super-secret-refresh-token';

      expect(service.sha256(token)).not.toContain(token);
    });

    it('lida com string vazia e com caracteres multibyte', () => {
      expect(service.sha256('')).toMatch(/^[0-9a-f]{64}$/);
      expect(service.sha256('ação-日本語')).toMatch(/^[0-9a-f]{64}$/);
      expect(service.sha256('ação')).not.toBe(service.sha256('acao'));
    });
  });
});
