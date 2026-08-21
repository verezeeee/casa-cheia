import { Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { ConfigService } from '@nestjs/config';
import type { JwtSignOptions } from '@nestjs/jwt';
import { JsonWebTokenError, JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import type { jwtConfig } from '../config/configuration';
import type {
  AccessTokenPayload,
  JwtPayload,
  RefreshTokenPayload,
  SignedAccessToken,
  SignedRefreshToken,
  VerifiedJwtPayload,
} from './types/jwt-payload.type';

/**
 * Algoritmo único aceito para assinar E verificar. Fixá-lo fecha a classe de
 * ataques de "algorithm confusion" (`alg: none`, ou HMAC verificado com uma
 * chave pública) — o verificador nunca deixa o token escolher o algoritmo.
 */
export const JWT_ALGORITHM = 'HS256' as const;

/** Namespace `jwt` de `config/configuration.ts`, derivado da própria factory. */
type JwtNamespaceConfig = ConfigType<typeof jwtConfig>;

/** Configuração de JWT já validada: segredos garantidamente presentes. */
export interface ResolvedJwtConfig {
  accessSecret: string;
  accessExpiresIn: string;
  refreshSecret: string;
  refreshExpiresIn: string;
}

/**
 * Lê e valida o namespace `jwt` do `ConfigService`.
 *
 * Erros aqui são de CONFIGURAÇÃO, não de runtime: são lançados durante a
 * construção do provider (boot), derrubando a aplicação em vez de deixá-la
 * subir e falhar no primeiro login. `process.env` nunca é lido diretamente —
 * a única fonte é o `ConfigService`.
 */
export function resolveJwtConfig(
  configService: ConfigService,
): ResolvedJwtConfig {
  const config = configService.get<JwtNamespaceConfig>('jwt');

  const accessSecret = config?.secret;
  const refreshSecret = config?.refreshSecret;

  if (!accessSecret) {
    throw new Error(
      'Configuração ausente: `jwt.secret` (JWT_SECRET) é obrigatória para assinar access tokens.',
    );
  }

  if (!refreshSecret) {
    throw new Error(
      'Configuração ausente: `jwt.refreshSecret` (JWT_REFRESH_SECRET) é obrigatória para assinar refresh tokens.',
    );
  }

  // Defesa em profundidade: com segredos iguais, um refresh token passaria a
  // valer como access token (e vice-versa), anulando a separação de escopos
  // e a revogação por rotação de família.
  if (accessSecret === refreshSecret) {
    throw new Error(
      'Configuração inválida: JWT_SECRET e JWT_REFRESH_SECRET devem ser diferentes — segredos iguais permitiriam usar um refresh token como access token.',
    );
  }

  return {
    accessSecret,
    accessExpiresIn: config.expiresIn,
    refreshSecret,
    refreshExpiresIn: config.refreshExpiresIn,
  };
}

/** Escopo do token, usado apenas para mensagens de erro e validação de shape. */
type TokenScope = 'access' | 'refresh';

/**
 * Emissão e verificação de JWTs de autenticação.
 *
 * DECISÃO CENTRAL: access e refresh tokens usam SEGREDOS DIFERENTES e cada
 * chamada a `sign`/`verify` passa o segredo explicitamente, em vez de confiar
 * no segredo default registrado no `JwtModule`. Consequência prática: um
 * refresh token (longevo, sem escopo de acesso a recursos) nunca é aceito
 * onde se espera um access token, mesmo que alguém, no futuro, registre um
 * segredo global no módulo ou injete este `JwtService` em outro provider.
 *
 * Este serviço é deliberadamente SEM ESTADO e sem I/O: não conhece banco,
 * usuário ou sessão. A persistência do refresh token (hash, família,
 * revogação) é responsabilidade do fluxo de autenticação.
 */
@Injectable()
export class TokenService {
  private readonly config: ResolvedJwtConfig;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    this.config = resolveJwtConfig(this.configService);
  }

  /**
   * Emite um access token curto, com um `jti` novo a cada chamada — dois
   * tokens do mesmo usuário emitidos no mesmo segundo são distintos e
   * individualmente rastreáveis.
   */
  signAccessToken(payload: AccessTokenPayload): SignedAccessToken {
    const claims: JwtPayload = {
      sub: payload.sub,
      email: payload.email,
      role: payload.role,
      jti: randomUUID(),
    };

    const token = this.sign(
      claims,
      this.config.accessSecret,
      this.config.accessExpiresIn,
    );
    const { iat, exp } = this.readTimeClaims(token);

    return { token, expiresIn: exp - iat };
  }

  /**
   * Emite um refresh token longevo, atrelado a uma família de rotação.
   *
   * `expiresAt` vem da claim `exp` do token recém-emitido (e não de um
   * `Date.now() + ttl` recalculado): o registro persistido pelo chamador
   * expira exatamente junto com o token, sem janela de divergência.
   */
  signRefreshToken(payload: RefreshTokenPayload): SignedRefreshToken {
    const jti = randomUUID();
    const claims: JwtPayload = {
      sub: payload.sub,
      email: payload.email,
      role: payload.role,
      familyId: payload.familyId,
      jti,
    };

    const token = this.sign(
      claims,
      this.config.refreshSecret,
      this.config.refreshExpiresIn,
    );
    const { exp } = this.readTimeClaims(token);

    return { token, jti, expiresAt: new Date(exp * 1000) };
  }

  /**
   * Valida um access token. Lança `TokenExpiredError` se expirado e
   * `JsonWebTokenError` se a assinatura não confere — inclusive quando o
   * token é um refresh token válido, porque o segredo é outro.
   */
  verifyAccessToken(token: string): VerifiedJwtPayload {
    return this.verify(token, this.config.accessSecret, 'access');
  }

  /**
   * Valida um refresh token. Um access token válido é rejeitado aqui pelo
   * mesmo motivo (segredo distinto).
   */
  verifyRefreshToken(token: string): VerifiedJwtPayload {
    return this.verify(token, this.config.refreshSecret, 'refresh');
  }

  private sign(claims: JwtPayload, secret: string, expiresIn: string): string {
    return this.jwtService.sign(claims, {
      secret,
      algorithm: JWT_ALGORITHM,
      // `expiresIn` do `jsonwebtoken` é tipado como `StringValue | number`
      // (template literal do pacote `ms`); a configuração chega como `string`
      // livre. O cast é o único ponto de contato: um valor inválido explode
      // na primeira emissão, ainda no boot/smoke test.
      expiresIn: expiresIn as JwtSignOptions['expiresIn'],
    });
  }

  private verify(
    token: string,
    secret: string,
    scope: TokenScope,
  ): VerifiedJwtPayload {
    const payload = this.jwtService.verify<Record<string, unknown>>(token, {
      secret,
      algorithms: [JWT_ALGORITHM],
    });

    return this.assertPayload(payload, scope);
  }

  /**
   * Garante que o conteúdo assinado tem o formato esperado. A assinatura
   * prova a ORIGEM do token, não o seu SHAPE: um token legítimo emitido por
   * uma versão anterior do sistema (ou por outro serviço que compartilhe o
   * segredo) pode não ter as claims que os guards assumem existir.
   */
  private assertPayload(
    payload: Record<string, unknown>,
    scope: TokenScope,
  ): VerifiedJwtPayload {
    const required = ['sub', 'email', 'role', 'jti'];
    const missing: string[] = required.filter(
      (claim) => typeof payload[claim] !== 'string',
    );

    if (scope === 'refresh' && typeof payload.familyId !== 'string') {
      missing.push('familyId');
    }

    if (
      missing.length > 0 ||
      typeof payload.iat !== 'number' ||
      typeof payload.exp !== 'number'
    ) {
      throw new JsonWebTokenError(
        `Token ${scope} com claims inválidas ou ausentes: ${missing.join(', ') || 'iat/exp'}.`,
      );
    }

    return payload as unknown as VerifiedJwtPayload;
  }

  /** Lê `iat`/`exp` de um token RECÉM-EMITIDO por este serviço. */
  private readTimeClaims(token: string): { iat: number; exp: number } {
    const decoded = this.jwtService.decode<Record<string, unknown> | null>(
      token,
    );

    if (
      !decoded ||
      typeof decoded.iat !== 'number' ||
      typeof decoded.exp !== 'number'
    ) {
      throw new Error(
        'Token emitido sem as claims temporais `iat`/`exp` — verifique `jwt.expiresIn`/`jwt.refreshExpiresIn`.',
      );
    }

    return { iat: decoded.iat, exp: decoded.exp };
  }
}
