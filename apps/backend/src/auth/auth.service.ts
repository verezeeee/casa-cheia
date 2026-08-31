import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthTokensResponse, SessionUser } from '@poker-system/shared';
import { Prisma, type RefreshToken, type User } from '../generated/prisma';
import { randomUUID } from 'node:crypto';
import { HashService } from '../common/crypto/hash.service';
import { PasswordHasherService } from '../common/crypto/password-hasher.service';
import { PrismaService } from '../prisma/prisma.service';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';
import { TokenService } from './token.service';

/** Hash argon2id de uma senha nunca usada — ver `login` para o porquê. */
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

export interface LoginMetadata {
  userAgent?: string;
  ip?: string;
}

/** Resultado de login/refresh: corpo da resposta + o refresh token a ser gravado em cookie. */
export interface SessionIssued {
  tokens: AuthTokensResponse;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordHasher: PasswordHasherService,
    private readonly hashService: HashService,
    private readonly tokenService: TokenService,
  ) {}

  /**
   * Cria a conta.
   *
   * NÃO cria mais carteira (CL-BE-03): `Wallet` passou a ser POR CLUBE
   * (`Wallet.clubeId` NOT NULL, `@@unique([userId, clubeId])`). Uma conta
   * recém-criada não pertence a clube nenhum, logo não há carteira a criar
   * aqui — ela nasce no ingresso ao clube.
   * TODO(CL-BE-04/wallet): criar a carteira ao aceitar/registrar a
   * `ClubeMembership`, na mesma transação do vínculo.
   */
  async register(dto: RegisterDto): Promise<SessionUser> {
    const email = normalizeEmail(dto.email);
    const passwordHash = await this.passwordHasher.hash(dto.password);

    try {
      const user = await this.prisma.user.create({
        data: {
          email,
          passwordHash,
          name: dto.name,
          document: dto.document ?? null,
        },
      });

      return toSessionUser(user);
    } catch (error) {
      throw mapUniqueConstraintError(error);
    }
  }

  /**
   * Autentica e-mail/senha e abre uma nova família de refresh tokens.
   *
   * A verificação de senha SEMPRE roda (contra um hash dummy quando o
   * e-mail não existe), para que "e-mail inexistente" e "senha errada"
   * levem tempo equivalente — sem isso, o tempo de resposta vaza quais
   * e-mails estão cadastrados.
   */
  async login(dto: LoginDto, meta: LoginMetadata): Promise<SessionIssued> {
    const email = normalizeEmail(dto.email);
    const user = await this.prisma.user.findUnique({ where: { email } });

    const passwordValid = await this.passwordHasher.verify(
      dto.password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );

    if (!user || !user.isActive || !passwordValid) {
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }

    return this.issueSession(user, randomUUID(), meta);
  }

  /**
   * Roda o refresh token. Se o token apresentado já estiver revogado, é
   * reuso/roubo: a família inteira é revogada (ver `RefreshToken` em
   * identity.prisma) e a chamada falha.
   */
  async refresh(rawToken: string, meta: LoginMetadata): Promise<SessionIssued> {
    let subjectId: string;
    let familyId: string;

    try {
      const payload = this.tokenService.verifyRefreshToken(rawToken);
      if (!payload.familyId) {
        throw new UnauthorizedException(
          'Refresh token sem família de rotação.',
        );
      }
      subjectId = payload.sub;
      familyId = payload.familyId;
    } catch {
      throw new UnauthorizedException('Refresh token inválido ou expirado.');
    }

    const tokenHash = this.hashService.sha256(rawToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });

    if (
      !stored ||
      stored.userId !== subjectId ||
      stored.familyId !== familyId
    ) {
      throw new UnauthorizedException('Sessão não encontrada.');
    }

    if (stored.revokedAt) {
      await this.revokeFamily(stored.familyId);
      throw new UnauthorizedException(
        'Refresh token já utilizado — sessão comprometida, todos os dispositivos foram desconectados.',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: stored.userId },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Usuário inativo.');
    }

    return this.issueSession(user, stored.familyId, meta, stored);
  }

  /** Revoga o refresh token corrente. Idempotente: token ausente/já revogado não é erro. */
  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;

    const tokenHash = this.hashService.sha256(rawToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Leitura fresca do usuário autenticado (o token só garante `id` no instante da emissão). */
  async me(userId: string): Promise<SessionUser> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    return toSessionUser(user);
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Emite access+refresh e persiste a nova linha de `RefreshToken`. Quando
   * `previous` é informado (fluxo de refresh), revoga-o e aponta
   * `replacedByTokenId` para o sucessor na mesma transação — mantém a
   * cadeia de rotação auditável mesmo sob concorrência.
   */
  private async issueSession(
    user: User,
    familyId: string,
    meta: LoginMetadata,
    previous?: RefreshToken,
  ): Promise<SessionIssued> {
    const access = this.tokenService.signAccessToken({
      sub: user.id,
      email: user.email,
    });
    const refresh = this.tokenService.signRefreshToken({
      sub: user.id,
      email: user.email,
      familyId,
    });

    await this.prisma.$transaction(async (tx) => {
      const created = await tx.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: this.hashService.sha256(refresh.token),
          familyId,
          expiresAt: refresh.expiresAt,
          userAgent: meta.userAgent,
          ip: meta.ip,
        },
      });

      if (previous) {
        await tx.refreshToken.update({
          where: { id: previous.id },
          data: { revokedAt: new Date(), replacedByTokenId: created.id },
        });
      }
    });

    return {
      tokens: { accessToken: access.token, expiresIn: access.expiresIn },
      refreshToken: refresh.token,
      refreshTokenExpiresAt: refresh.expiresAt,
    };
  }
}

/** Exportada: `ClubService.createMemberWithNewUser` reaproveita (mesma regra de normalização, um cadastro é um cadastro). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toSessionUser(user: User): SessionUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
  };
}

/** Exportada: `ClubService.createMemberWithNewUser` reaproveita (mesmo P2002 de `users.email`). */
export function mapUniqueConstraintError(error: unknown): Error {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  ) {
    const target = (error.meta?.target as string[] | undefined) ?? [];
    if (target.includes('email')) {
      return new ConflictException('E-mail já cadastrado.');
    }
    if (target.includes('document')) {
      return new ConflictException('Documento já cadastrado.');
    }
    return new ConflictException('Registro já existe.');
  }
  return error as Error;
}
