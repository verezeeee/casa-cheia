/**
 * Contratos de transporte dos tokens JWT.
 *
 * Tipos puros, sem dependência de runtime — nada aqui importa Prisma, Nest ou
 * `jsonwebtoken`. O payload de um JWT trafega para fora do processo (browser,
 * app mobile) e é lido de volta como JSON cru; tipá-lo com enums/entidades do
 * Prisma daria uma falsa sensação de garantia: o que volta do token é apenas
 * o que o atacante/cliente enviou, validado pela ASSINATURA, não pelo tipo.
 */

/**
 * Claims da aplicação presentes em access e refresh tokens.
 *
 * `role` é `string` (e não o enum `UserRole` do Prisma) DE PROPÓSITO: este é
 * um tipo de transporte. Acoplá-lo ao client gerado do Prisma faria com que
 * uma renomeação de enum no schema virasse um erro de compilação em código de
 * borda, e ainda assim o valor vindo do token continuaria sendo um `string`
 * arbitrário em runtime. A conversão/validação para `UserRole` é
 * responsabilidade de quem consome (guards/serviços de autorização).
 */
export interface JwtPayload {
  /** `sub` (subject): id do usuário dono do token. */
  sub: string;
  email: string;
  /** Papel do usuário. Ver nota acima sobre o uso de `string`. */
  role: string;
  /**
   * `jti` (JWT ID): identificador único do token (UUID v4), novo a cada
   * emissão. É a chave que permite revogação/rastreio individual de um token
   * mesmo quando dois tokens carregam exatamente o mesmo conteúdo.
   */
  jti: string;
  /**
   * Presente APENAS em refresh tokens: agrupa a cadeia de rotação originada
   * de um mesmo login (ver `RefreshToken.familyId` no schema Prisma).
   */
  familyId?: string;
}

/** Claims registrados pelo emissor (`jsonwebtoken`), em segundos epoch. */
export interface JwtTimeClaims {
  /** `iat` (issued at). */
  iat: number;
  /** `exp` (expiration time). */
  exp: number;
}

/**
 * Payload devolvido por uma verificação bem-sucedida. É um `JwtPayload` (logo
 * assinável a qualquer consumidor que espere só as claims da aplicação) com
 * os tempos do token, necessários, por exemplo, para calcular a validade
 * remanescente de uma sessão sem re-decodificar o token.
 */
export type VerifiedJwtPayload = JwtPayload & JwtTimeClaims;

/**
 * Entrada de `TokenService.signAccessToken`. `jti` é gerado pelo serviço
 * (nunca fornecido pelo chamador) e `familyId` não existe em access tokens.
 */
export type AccessTokenPayload = Omit<JwtPayload, 'jti' | 'familyId'>;

/**
 * Entrada de `TokenService.signRefreshToken`. `familyId` é obrigatório: um
 * refresh token só existe dentro de uma família de rotação.
 */
export type RefreshTokenPayload = Omit<JwtPayload, 'jti'> &
  Required<Pick<JwtPayload, 'familyId'>>;

/** Resultado da emissão de um access token. */
export interface SignedAccessToken {
  token: string;
  /** Tempo de vida do token em SEGUNDOS (derivado de `exp - iat`). */
  expiresIn: number;
}

/** Resultado da emissão de um refresh token. */
export interface SignedRefreshToken {
  token: string;
  /** `jti` gerado nesta emissão, para persistir/correlacionar a sessão. */
  jti: string;
  /**
   * Instante exato de expiração, derivado da claim `exp` do token emitido —
   * e não recalculado a partir do relógio local. Quem persiste a sessão
   * (`RefreshToken.expiresAt`) grava exatamente o que o token afirma.
   */
  expiresAt: Date;
}
