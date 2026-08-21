import { Test } from '@nestjs/testing';
import { CryptoModule } from './crypto.module';
import { HashService } from './hash.service';
import { PasswordHasherService } from './password-hasher.service';

describe('CryptoModule', () => {
  it('resolve e exporta PasswordHasherService e HashService', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [CryptoModule],
    }).compile();

    expect(moduleRef.get(PasswordHasherService)).toBeInstanceOf(
      PasswordHasherService,
    );
    expect(moduleRef.get(HashService)).toBeInstanceOf(HashService);

    await moduleRef.close();
  });

  it('fornece os services como singletons no escopo do módulo', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [CryptoModule],
    }).compile();

    expect(moduleRef.get(HashService)).toBe(moduleRef.get(HashService));

    await moduleRef.close();
  });
});
