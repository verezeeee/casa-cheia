import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  ClubeMembershipDto,
  ClubeMembershipStatus as SharedClubeMembershipStatus,
  ClubeRole as SharedClubeRole,
  ClubeStatus as SharedClubeStatus,
  ClubeSummaryDto,
} from '@poker-system/shared';
import type {
  Clube,
  ClubeMembership,
  ClubeMembershipStatus,
} from '../generated/prisma';
import { randomBytes } from 'node:crypto';
import { mapUniqueConstraintError, normalizeEmail } from '../auth/auth.service';
import { PasswordHasherService } from '../common/crypto/password-hasher.service';
import { PrismaService } from '../prisma/prisma.service';
import type { UpsertClubeMembershipDto } from './dto/upsert-clube-membership.dto';

/**
 * Senha temporária de um usuário CADASTRADO PELO ADMIN (sem autocadastro):
 * 9 bytes aleatórios em base64url — 12 caracteres, cumpre o `@MinLength(8)`
 * que `RegisterDto`/login também exigem. Só existe em memória até o hash;
 * devolvida ao admin UMA VEZ na resposta (`ClubeMembershipDto.temporaryPassword`),
 * nunca persistida em claro nem recuperável depois.
 */
function generateTemporaryPassword(): string {
  return randomBytes(9).toString('base64url');
}

/** Mesmos literais em Prisma e @poker-system/shared (ver base.prisma). */
function toClubeSummary(
  membership: Pick<ClubeMembership, 'role'> & { clube: Clube },
): ClubeSummaryDto {
  return {
    id: membership.clube.id,
    name: membership.clube.name,
    status: membership.clube.status as unknown as SharedClubeStatus,
    role: membership.role as unknown as SharedClubeRole,
  };
}

function toMembershipDto(
  membership: ClubeMembership & {
    user: { name: string; email: string; document: string | null };
  },
): ClubeMembershipDto {
  return {
    id: membership.id,
    userId: membership.userId,
    name: membership.user.name,
    email: membership.user.email,
    document: membership.user.document,
    role: membership.role as unknown as SharedClubeRole,
    status: membership.status as unknown as SharedClubeMembershipStatus,
    createdAt: membership.createdAt.toISOString(),
  };
}

@Injectable()
export class ClubService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordHasher: PasswordHasherService,
  ) {}

  /**
   * ATENÇÃO — esta é a ÚNICA consulta legitimamente cross-clube da aplicação.
   *
   * A convenção do projeto é que toda query de negócio filtra por um
   * `clubeId` (o discriminador de tenant, base da RLS — ver ADR-0001). Aqui
   * não filtra, e é de propósito: esta rota alimenta o SELETOR de clube, ou
   * seja, roda ANTES de existir um clube corrente. Perguntar "de quais clubes
   * eu sou membro?" exige varrer os vínculos do usuário através de todos os
   * clubes; é a pergunta que define o tenant, não uma pergunta dentro dele.
   *
   * Note que o filtro de tenant é substituído aqui por um filtro de
   * `userId` igualmente restritivo: nenhuma linha de clube alheio é
   * alcançável, porque a varredura parte SEMPRE dos vínculos do próprio
   * usuário autenticado. Qualquer outra query sem `clubeId` no `where` deve
   * ser tratada como bug de vazamento entre tenants.
   *
   * Clube `SUSPENDED`/`CANCELLED` continua na lista: o bloqueio é
   * operacional (nenhuma rota financeira opera), não de visibilidade — sumir
   * com o clube faria o jogador achar que perdeu o acesso ao histórico. O
   * cliente usa `status` para desabilitar a operação, não para filtrar.
   */
  async listMyClubes(userId: string): Promise<ClubeSummaryDto[]> {
    const memberships = await this.prisma.clubeMembership.findMany({
      where: { userId, status: 'ACTIVE' },
      include: { clube: true },
      orderBy: { clube: { name: 'asc' } },
    });

    return memberships.map(toClubeSummary);
  }

  /**
   * Detalhe de um clube. Sem vínculo ACTIVE responde 404 (não 403): 403
   * confirmaria que o clube existe, transformando a rota num oráculo de
   * enumeração de tenants. Para quem não é membro, o clube simplesmente não
   * existe.
   */
  async getClube(userId: string, clubeId: string): Promise<ClubeSummaryDto> {
    const membership = await this.prisma.clubeMembership.findUnique({
      where: { clubeId_userId: { clubeId, userId } },
      include: { clube: true },
    });

    if (!membership || membership.status !== 'ACTIVE') {
      throw new NotFoundException('Clube não encontrado.');
    }

    return toClubeSummary(membership);
  }

  /** Membros do clube, incluindo os `REVOKED` (trilha de quem já foi da casa). */
  async listMembers(
    userId: string,
    clubeId: string,
  ): Promise<ClubeMembershipDto[]> {
    await this.requireAdmin(userId, clubeId);

    const memberships = await this.prisma.clubeMembership.findMany({
      where: { clubeId },
      include: {
        user: { select: { name: true, email: true, document: true } },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    });

    return memberships.map(toMembershipDto);
  }

  /**
   * Dois modos, mutuamente exclusivos (ver docblock de
   * `UpsertClubeMembershipDto`): `userId` vincula alguém que já tem conta;
   * `email`+`name` CADASTRA um usuário novo — o admin registrando alguém que
   * nunca se autocadastrou (não há convite por e-mail nesta fase, ADR-0003).
   */
  async upsertMember(
    userId: string,
    clubeId: string,
    dto: UpsertClubeMembershipDto,
  ): Promise<ClubeMembershipDto> {
    await this.requireAdmin(userId, clubeId);

    const status = dto.status ?? 'ACTIVE';
    const isNewUser = dto.userId === undefined;

    if (isNewUser && (!dto.email || !dto.name)) {
      throw new BadRequestException(
        'Informe userId (usuário existente) OU email + name (cadastrar um usuário novo).',
      );
    }
    if (!isNewUser && (dto.email !== undefined || dto.name !== undefined)) {
      throw new BadRequestException(
        'userId e email/name são exclusivos — escolha vincular um usuário existente OU cadastrar um novo.',
      );
    }

    // Trava anti-lockout: sem ela, o único admin do clube consegue se
    // rebaixar/revogar e ninguém mais consegue administrar o clube — a
    // recuperação exigiria acesso direto ao banco (não há super-admin,
    // ADR-0001). Inerte no cadastro de usuário novo: `dto.userId` nunca bate
    // com o próprio admin quando está indefinido.
    if (
      dto.userId === userId &&
      (dto.role !== 'ADMIN' || status !== 'ACTIVE')
    ) {
      throw new BadRequestException(
        'Um administrador não pode remover o próprio acesso ao clube.',
      );
    }

    if (isNewUser) {
      return this.createMemberWithNewUser(clubeId, dto, status);
    }

    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
      select: { name: true, email: true, document: true },
    });
    if (!user) throw new NotFoundException('Usuário não encontrado.');

    const membership = await this.prisma.clubeMembership.upsert({
      where: { clubeId_userId: { clubeId, userId: dto.userId! } },
      create: { clubeId, userId: dto.userId!, role: dto.role, status },
      update: { role: dto.role, status },
    });

    return toMembershipDto({ ...membership, user });
  }

  /**
   * Cria a CONTA, o VÍNCULO e a CARTEIRA numa transação só — fecha o TODO de
   * `AuthService.register` ("criar a carteira ao aceitar/registrar a
   * ClubeMembership"). Senha gerada pelo servidor (`generateTemporaryPassword`),
   * devolvida ao admin uma única vez em `temporaryPassword` — nunca persistida
   * em claro nem recuperável depois; quem cadastrou precisa repassá-la ao
   * jogador (ex.: no balcão) antes de fechar a tela.
   */
  private async createMemberWithNewUser(
    clubeId: string,
    dto: UpsertClubeMembershipDto,
    status: ClubeMembershipStatus,
  ): Promise<ClubeMembershipDto> {
    const email = normalizeEmail(dto.email!);
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await this.passwordHasher.hash(temporaryPassword);

    try {
      const { membership, user } = await this.prisma.$transaction(
        async (tx) => {
          const user = await tx.user.create({
            data: { email, passwordHash, name: dto.name! },
          });
          const membership = await tx.clubeMembership.create({
            data: { clubeId, userId: user.id, role: dto.role, status },
          });
          // Carteira do (usuário, clube) — nasce junto, como qualquer outro
          // ingresso ao clube (ver nota em `wallet.e2e-spec.ts`).
          await tx.wallet.create({ data: { userId: user.id, clubeId } });
          return { membership, user };
        },
      );

      return {
        ...toMembershipDto({ ...membership, user }),
        temporaryPassword,
      };
    } catch (error) {
      throw mapUniqueConstraintError(error);
    }
  }

  /**
   * Checagem manual de papel, TEMPORÁRIA: CL-BE-03 traz o
   * `ClubeMembershipGuard` + `@Roles`/`@CurrentClube()`, e quando ele mesclar
   * estas duas linhas viram um decorator no controller.
   *
   * Sem vínculo ACTIVE → 404 (mesma resposta de clube inexistente, ver
   * `getClube`). Com vínculo, mas sem papel → 403: para o membro, a existência
   * do clube já não é segredo, e 404 aqui só confundiria quem tem acesso
   * legítimo à casa.
   */
  private async requireAdmin(userId: string, clubeId: string): Promise<void> {
    const membership = await this.prisma.clubeMembership.findUnique({
      where: { clubeId_userId: { clubeId, userId } },
      select: { role: true, status: true },
    });

    if (!membership || membership.status !== 'ACTIVE') {
      throw new NotFoundException('Clube não encontrado.');
    }
    if (membership.role !== 'ADMIN') {
      throw new ForbiddenException('Ação restrita a administradores do clube.');
    }
  }
}
