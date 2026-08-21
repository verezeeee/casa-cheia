import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { envValidationSchema } from './env.validation';

describe('ConfigModule (validationSchema integration)', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('falha o boot do módulo quando env obrigatória está faltando', async () => {
    delete process.env.JWT_SECRET;
    delete process.env.DATABASE_URL;

    await expect(
      Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            isGlobal: true,
            ignoreEnvFile: true,
            validationSchema: envValidationSchema,
          }),
        ],
      }).compile(),
    ).rejects.toThrow();
  });

  it('inicializa normalmente quando toda env obrigatória está presente', async () => {
    process.env.DATABASE_URL =
      'postgresql://poker:poker@localhost:5432/poker_system';
    process.env.JWT_SECRET = 'a-secret-with-more-than-16-chars';
    process.env.JWT_REFRESH_SECRET = 'another-secret-with-more-than-16-chars';
    process.env.ABACATEPAY_API_KEY = 'abacatepay_test_key';
    process.env.ABACATEPAY_WEBHOOK_SECRET = 'abacatepay_webhook_secret';

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          validationSchema: envValidationSchema,
        }),
      ],
    }).compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });
});
