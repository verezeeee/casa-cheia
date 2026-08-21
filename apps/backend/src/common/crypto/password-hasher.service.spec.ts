import * as argon2 from 'argon2';
import {
  ARGON2_OPTIONS,
  PasswordHasherService,
} from './password-hasher.service';

describe('PasswordHasherService', () => {
  let service: PasswordHasherService;

  const PLAIN = 'S3nh@-Muito-F0rte!';

  beforeEach(() => {
    service = new PasswordHasherService();
  });

  describe('parâmetros de custo', () => {
    it('usa argon2id com os parâmetros recomendados pela OWASP', () => {
      expect(ARGON2_OPTIONS).toEqual({
        type: argon2.argon2id,
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
        hashLength: 32,
      });
    });
  });

  describe('hash', () => {
    it('nunca retorna a senha em claro e gera um encoded hash argon2id', async () => {
      const hash = await service.hash(PLAIN);

      expect(hash).not.toBe(PLAIN);
      expect(hash).not.toContain(PLAIN);
      expect(hash.startsWith('$argon2id$')).toBe(true);
    });

    it('gera hashes DIFERENTES para a mesma senha (salt aleatório por chamada)', async () => {
      const [first, second] = await Promise.all([
        service.hash(PLAIN),
        service.hash(PLAIN),
      ]);

      expect(first).not.toBe(second);
      // Ambos continuam válidos apesar de diferentes.
      await expect(service.verify(PLAIN, first)).resolves.toBe(true);
      await expect(service.verify(PLAIN, second)).resolves.toBe(true);
    });

    it('também consegue hashear senha vazia sem lançar', async () => {
      const hash = await service.hash('');

      expect(typeof hash).toBe('string');
      await expect(service.verify('', hash)).resolves.toBe(true);
    });
  });

  describe('verify', () => {
    it('retorna true para a senha correta', async () => {
      const hash = await service.hash(PLAIN);

      await expect(service.verify(PLAIN, hash)).resolves.toBe(true);
    });

    it('retorna false para senha incorreta', async () => {
      const hash = await service.hash(PLAIN);

      await expect(service.verify('senha-errada', hash)).resolves.toBe(false);
      await expect(service.verify(`${PLAIN} `, hash)).resolves.toBe(false);
    });

    it('retorna false (sem lançar) para hash malformado ou de outro algoritmo', async () => {
      await expect(service.verify(PLAIN, 'nao-e-um-hash-argon2')).resolves.toBe(
        false,
      );
      await expect(service.verify(PLAIN, '')).resolves.toBe(false);
      await expect(
        // hash bcrypt legado
        service.verify(PLAIN, '$2b$10$abcdefghijklmnopqrstuv'),
      ).resolves.toBe(false);
      await expect(
        service.verify(PLAIN, '$argon2id$v=19$m=19456,t=2,p=1$corrompido'),
      ).resolves.toBe(false);
    });
  });
});
