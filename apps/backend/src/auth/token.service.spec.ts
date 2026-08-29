import { ConfigService } from '@nestjs/config';
import { JsonWebTokenError, JwtService, TokenExpiredError } from '@nestjs/jwt';
import { resolveJwtConfig, TokenService } from './token.service';
import type {
  AccessTokenPayload,
  RefreshTokenPayload,
} from './types/jwt-payload.type';

const ACCESS_SECRET = 'access-secret-com-mais-de-16-chars';
const REFRESH_SECRET = 'refresh-secret-com-mais-de-16-chars';

interface JwtNamespace {
  secret?: string;
  expiresIn?: string;
  refreshSecret?: string;
  refreshExpiresIn?: string;
}

const DEFAULT_NAMESPACE: JwtNamespace = {
  secret: ACCESS_SECRET,
  expiresIn: '15m',
  refreshSecret: REFRESH_SECRET,
  refreshExpiresIn: '7d',
};

/**
 * `ConfigService` real (sem I/O): recebe o objeto de configuração já
 * resolvido, exatamente como o `registerAs('jwt', ...)` o entregaria.
 * Nenhum teste depende de `process.env`.
 */
const buildConfigService = (namespace?: JwtNamespace): ConfigService =>
  new ConfigService(namespace === undefined ? {} : { jwt: namespace });

const buildService = (overrides: Partial<JwtNamespace> = {}): TokenService =>
  new TokenService(
    new JwtService(),
    buildConfigService({ ...DEFAULT_NAMESPACE, ...overrides }),
  );

/** Decodificador independente do serviço, para inspecionar claims cruas. */
const decode = (token: string): Record<string, unknown> =>
  new JwtService().decode<Record<string, unknown>>(token);

const ACCESS_PAYLOAD: AccessTokenPayload = {
  sub: '11111111-1111-4111-8111-111111111111',
  email: 'jogador@poker.test',
};

const REFRESH_PAYLOAD: RefreshTokenPayload = {
  ...ACCESS_PAYLOAD,
  familyId: '22222222-2222-4222-8222-222222222222',
};

describe('TokenService', () => {
  describe('configuração', () => {
    it('falha na construção quando `jwt.secret` está ausente', () => {
      expect(
        () =>
          new TokenService(
            new JwtService(),
            buildConfigService({ ...DEFAULT_NAMESPACE, secret: undefined }),
          ),
      ).toThrow(/jwt\.secret/);
    });

    it('falha na construção quando `jwt.refreshSecret` está ausente', () => {
      expect(
        () =>
          new TokenService(
            new JwtService(),
            buildConfigService({
              ...DEFAULT_NAMESPACE,
              refreshSecret: undefined,
            }),
          ),
      ).toThrow(/jwt\.refreshSecret/);
    });

    it('falha na construção quando o namespace `jwt` inteiro está ausente', () => {
      expect(
        () => new TokenService(new JwtService(), buildConfigService()),
      ).toThrow(/jwt\.secret/);
    });

    it('rejeita segredos de access e refresh iguais', () => {
      expect(() =>
        resolveJwtConfig(
          buildConfigService({
            ...DEFAULT_NAMESPACE,
            refreshSecret: ACCESS_SECRET,
          }),
        ),
      ).toThrow(/devem ser diferentes/);
    });

    it('lê os segredos apenas do ConfigService, ignorando process.env', () => {
      const originalEnv = process.env.JWT_SECRET;
      process.env.JWT_SECRET = 'segredo-de-env-que-nao-deve-ser-usado';

      try {
        const service = buildService();
        const { token } = service.signAccessToken(ACCESS_PAYLOAD);

        // Verifica com o segredo do ConfigService: se o serviço tivesse lido
        // `process.env`, a assinatura não bateria.
        expect(
          new JwtService().verify<Record<string, unknown>>(token, {
            secret: ACCESS_SECRET,
          }).sub,
        ).toBe(ACCESS_PAYLOAD.sub);
      } finally {
        if (originalEnv === undefined) {
          delete process.env.JWT_SECRET;
        } else {
          process.env.JWT_SECRET = originalEnv;
        }
      }
    });
  });

  describe('signAccessToken', () => {
    it('emite um token verificável com as claims da aplicação', () => {
      const service = buildService();

      const { token } = service.signAccessToken(ACCESS_PAYLOAD);
      const payload = service.verifyAccessToken(token);

      expect(payload).toMatchObject({
        sub: ACCESS_PAYLOAD.sub,
        email: ACCESS_PAYLOAD.email,
      });
      expect(typeof payload.jti).toBe('string');
      // Access token não carrega família de rotação.
      expect(payload.familyId).toBeUndefined();
      // Nem papel: papel é do vínculo com o clube, e o token não conhece clube.
      expect(decode(token).role).toBeUndefined();
    });

    it('não aceita mais um token legado que só tinha `role` como papel', () => {
      const service = buildService();
      // Token assinado por uma versão anterior: claims da aplicação presentes,
      // mas SEM `jti`. Continua sendo rejeitado pelo shape, não pela assinatura.
      const legacy = new JwtService().sign(
        { sub: ACCESS_PAYLOAD.sub, email: ACCESS_PAYLOAD.email, role: 'ADMIN' },
        { secret: ACCESS_SECRET, expiresIn: '15m' },
      );

      expect(() => service.verifyAccessToken(legacy)).toThrow(
        JsonWebTokenError,
      );
    });

    it('respeita o `expiresIn` configurado (exp - iat)', () => {
      const { token, expiresIn } = buildService({
        expiresIn: '15m',
      }).signAccessToken(ACCESS_PAYLOAD);
      const claims = decode(token);

      expect(expiresIn).toBe(15 * 60);
      expect((claims.exp as number) - (claims.iat as number)).toBe(15 * 60);
    });

    it('honra um `expiresIn` diferente vindo da configuração', () => {
      const { expiresIn } = buildService({ expiresIn: '2h' }).signAccessToken(
        ACCESS_PAYLOAD,
      );

      expect(expiresIn).toBe(2 * 60 * 60);
    });

    it('gera um `jti` novo a cada chamada para o mesmo payload', () => {
      const service = buildService();

      const first = service.verifyAccessToken(
        service.signAccessToken(ACCESS_PAYLOAD).token,
      );
      const second = service.verifyAccessToken(
        service.signAccessToken(ACCESS_PAYLOAD).token,
      );

      expect(first.jti).not.toBe(second.jti);
      expect(first.sub).toBe(second.sub);
    });

    it('assina com o segredo de access (não com o de refresh)', () => {
      const { token } = buildService().signAccessToken(ACCESS_PAYLOAD);

      expect(() => {
        new JwtService().verify(token, { secret: ACCESS_SECRET });
      }).not.toThrow();
      expect(() => {
        new JwtService().verify(token, { secret: REFRESH_SECRET });
      }).toThrow(JsonWebTokenError);
    });
  });

  describe('signRefreshToken', () => {
    it('emite um token verificável com `familyId` e devolve o `jti` emitido', () => {
      const service = buildService();

      const { token, jti } = service.signRefreshToken(REFRESH_PAYLOAD);
      const payload = service.verifyRefreshToken(token);

      expect(payload.jti).toBe(jti);
      expect(payload.familyId).toBe(REFRESH_PAYLOAD.familyId);
      expect(payload.sub).toBe(REFRESH_PAYLOAD.sub);
    });

    it('respeita o `refreshExpiresIn` configurado (exp - iat)', () => {
      const { token } = buildService({
        refreshExpiresIn: '7d',
      }).signRefreshToken(REFRESH_PAYLOAD);
      const claims = decode(token);

      expect((claims.exp as number) - (claims.iat as number)).toBe(
        7 * 24 * 60 * 60,
      );
    });

    it('devolve `expiresAt` derivado da claim `exp` do token', () => {
      const { token, expiresAt } =
        buildService().signRefreshToken(REFRESH_PAYLOAD);
      const claims = decode(token);

      expect(expiresAt).toBeInstanceOf(Date);
      expect(expiresAt.getTime()).toBe((claims.exp as number) * 1000);
    });

    it('gera um `jti` novo a cada chamada para o mesmo payload', () => {
      const service = buildService();

      const first = service.signRefreshToken(REFRESH_PAYLOAD);
      const second = service.signRefreshToken(REFRESH_PAYLOAD);

      expect(first.jti).not.toBe(second.jti);
      expect(first.token).not.toBe(second.token);
    });
  });

  describe('separação entre segredos de access e refresh', () => {
    it('rejeita em `verifyAccessToken` um token assinado como refresh', () => {
      const service = buildService();
      const { token } = service.signRefreshToken(REFRESH_PAYLOAD);

      expect(() => service.verifyAccessToken(token)).toThrow(JsonWebTokenError);
    });

    it('rejeita em `verifyRefreshToken` um token assinado como access', () => {
      const service = buildService();
      const { token } = service.signAccessToken(ACCESS_PAYLOAD);

      expect(() => service.verifyRefreshToken(token)).toThrow(
        JsonWebTokenError,
      );
    });
  });

  describe('expiração', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('rejeita um access token expirado', () => {
      const service = buildService({ expiresIn: '15m' });
      const { token } = service.signAccessToken(ACCESS_PAYLOAD);

      expect(() => service.verifyAccessToken(token)).not.toThrow();

      jest.advanceTimersByTime(15 * 60 * 1000 + 1_000);

      expect(() => service.verifyAccessToken(token)).toThrow(TokenExpiredError);
    });

    it('rejeita um refresh token expirado', () => {
      const service = buildService({ refreshExpiresIn: '7d' });
      const { token } = service.signRefreshToken(REFRESH_PAYLOAD);

      expect(() => service.verifyRefreshToken(token)).not.toThrow();

      jest.advanceTimersByTime(7 * 24 * 60 * 60 * 1000 + 1_000);

      expect(() => service.verifyRefreshToken(token)).toThrow(
        TokenExpiredError,
      );
    });
  });

  describe('validação do conteúdo assinado', () => {
    it('rejeita token com assinatura válida mas claims da aplicação ausentes', () => {
      const service = buildService();
      const token = new JwtService().sign(
        { sub: '1' },
        { secret: ACCESS_SECRET, expiresIn: '15m' },
      );

      expect(() => service.verifyAccessToken(token)).toThrow(
        /claims inválidas ou ausentes/,
      );
    });

    it('rejeita refresh token sem `familyId`', () => {
      const service = buildService();
      const token = new JwtService().sign(
        { ...ACCESS_PAYLOAD, jti: 'algum-jti' },
        { secret: REFRESH_SECRET, expiresIn: '7d' },
      );

      expect(() => service.verifyRefreshToken(token)).toThrow(/familyId/);
    });

    it('rejeita token sem claims temporais (`iat`/`exp`)', () => {
      const service = buildService();
      const token = new JwtService().sign(
        { ...ACCESS_PAYLOAD, jti: 'algum-jti' },
        { secret: ACCESS_SECRET, noTimestamp: true },
      );

      expect(() => service.verifyAccessToken(token)).toThrow(/iat\/exp/);
    });

    it('rejeita token assinado com outro algoritmo, mesmo com o segredo correto', () => {
      const service = buildService();
      const token = new JwtService().sign(
        { ...ACCESS_PAYLOAD, jti: 'algum-jti' },
        { secret: ACCESS_SECRET, algorithm: 'HS512', expiresIn: '15m' },
      );

      expect(() => service.verifyAccessToken(token)).toThrow(JsonWebTokenError);
    });

    it('falha alto se o token emitido não trouxer `iat`/`exp`', () => {
      const jwtService = new JwtService();
      jest.spyOn(jwtService, 'decode').mockReturnValue(null);
      const service = new TokenService(
        jwtService,
        buildConfigService(DEFAULT_NAMESPACE),
      );

      expect(() => service.signAccessToken(ACCESS_PAYLOAD)).toThrow(
        /claims temporais/,
      );
    });
  });
});
