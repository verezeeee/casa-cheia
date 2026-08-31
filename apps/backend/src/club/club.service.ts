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
import { Prisma } from '../generated/prisma';
import type {
  Clube,
  ClubeMembership,
  ClubeMembershipStatus,
} from '../generated/prisma';
import { randomBytes } from 'node:crypto';
import { mapUniqueConstraintError, normalizeEmail } from '../auth/auth.service';
import { PasswordHasherService } from '../common/crypto/password-hasher.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateClubeDto } from './dto/create-clube.dto';
import type { JoinClubeDto } from './dto/join-clube.dto';
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

/**
 * Código de ingresso do clube: 6 dígitos, primeiro dígito 1-9 (sem zero à
 * esquerda — mais simples de digitar/falar). Não é segredo forte (só
 * ~900 mil combinações) — a rota que o consome (`joinByCode`) é
 * throttled propositalmente (ver `club.controller.ts`), e a aprovação de um
 * ADMIN antes do ingresso virar definitivo fica pra quando essa flag existir
 * (ver docblock de `joinByCode`).
 */
function generateJoinCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/**
 * Mesmos literais em Prisma e @poker-system/shared (ver base.prisma).
 * `joinCode` só é preenchido pra quem é `ADMIN` do clube — é a credencial de
 * convite, não deve vazar pra um `PLAYER` olhando a própria lista de clubes.
 */
function toClubeSummary(
  membership: Pick<ClubeMembership, 'role'> & { clube: Clube },
): ClubeSummaryDto {
  const isAdmin = membership.role === 'ADMIN';
  return {
    id: membership.clube.id,
    name: membership.clube.name,
    status: membership.clube.status as unknown as SharedClubeStatus,
    role: membership.role as unknown as SharedClubeRole,
    ...(isAdmin ? { joinCode: membership.clube.joinCode } : {}),
  };
}

function toMembershipDto(
  membership: ClubeMembership & {
    user: {
      name: string;
      email: string;
      document: string | null;
      phone: string | null;
      isGuest: boolean;
    };
  },
): ClubeMembershipDto {
  return {
    id: membership.id,
    userId: membership.userId,
    name: membership.user.name,
    email: membership.user.email,
    document: membership.user.document,
    phone: membership.user.phone,
    isGuest: membership.user.isGuest,
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
   * Cria um clube por autoatendimento — qualquer usuário autenticado pode
   * chamar. Clube, vínculo `ADMIN` e carteira nascem juntos na mesma
   * transação, mesmo padrão de `createMemberWithNewUser`. O `joinCode` é
   * gerado pelo servidor; como ele é auto-gerado (não input do usuário),
   * uma colisão de unicidade (estatisticamente rara, ~1 em 900 mil) NUNCA
   * deve virar erro pro chamador — regenera e tenta de novo.
   */
  async createClube(
    userId: string,
    dto: CreateClubeDto,
  ): Promise<ClubeSummaryDto> {
    const MAX_JOIN_CODE_ATTEMPTS = 5;

    for (let attempt = 1; attempt <= MAX_JOIN_CODE_ATTEMPTS; attempt++) {
      const joinCode = generateJoinCode();

      try {
        const membership = await this.prisma.$transaction(async (tx) => {
          const clube = await tx.clube.create({
            data: { name: dto.name, document: dto.document, joinCode },
          });
          const membership = await tx.clubeMembership.create({
            data: {
              clubeId: clube.id,
              userId,
              role: 'ADMIN',
              status: 'ACTIVE',
            },
          });
          await tx.wallet.create({ data: { userId, clubeId: clube.id } });
          return { ...membership, clube };
        });

        return toClubeSummary(membership);
      } catch (error) {
        const target =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
            ? ((error.meta?.target as string[] | undefined) ?? [])
            : undefined;

        // Colisão só no join_code (gerado por nós): regenera e tenta de
        // novo, silenciosamente. Qualquer outro conflito (ex.: `document`
        // duplicado, informado pelo usuário) é erro de verdade — propaga.
        const isJoinCodeCollision =
          target?.includes('join_code') && !target.includes('document');
        if (!isJoinCodeCollision || attempt === MAX_JOIN_CODE_ATTEMPTS) {
          throw mapUniqueConstraintError(error);
        }
      }
    }

    // Inalcançável (o loop sempre retorna ou lança), só satisfaz o compilador.
    throw new Error('Não foi possível gerar um código de clube único.');
  }

  /**
   * Ingresso imediato num clube existente via código — sem aprovação de um
   * ADMIN por enquanto (TODO: um toggle "exigir aprovação" nas
   * configurações do clube deve virar um `if` aqui no dia em que existir,
   * criando o vínculo como pendente em vez de `ACTIVE`).
   *
   * `upsert`, não `create`: reentrar com o mesmo código idempotentemente
   * REATIVA um vínculo `REVOKED` em vez de dar conflito. A carteira também é
   * `upsert` com `update: {}` — nunca sobrescreve saldo de uma carteira que
   * já existe (mesma regra do seed, ver `prisma/seed.ts`).
   *
   * 404 (não "código inválido" de outra forma) pra código inexistente: não
   * dá pra distinguir "código nunca existiu" de "clube foi desativado" sem
   * abrir uma pista de enumeração, mesmo padrão anti-enumeração do resto do
   * módulo.
   */
  async joinByCode(
    userId: string,
    dto: JoinClubeDto,
  ): Promise<ClubeSummaryDto> {
    const clube = await this.prisma.clube.findUnique({
      where: { joinCode: dto.code },
    });
    if (!clube) {
      throw new NotFoundException('Código inválido.');
    }

    const membership = await this.prisma.$transaction(async (tx) => {
      const membership = await tx.clubeMembership.upsert({
        where: { clubeId_userId: { clubeId: clube.id, userId } },
        create: { clubeId: clube.id, userId, role: 'PLAYER', status: 'ACTIVE' },
        update: { status: 'ACTIVE' },
      });
      await tx.wallet.upsert({
        where: { userId_clubeId: { userId, clubeId: clube.id } },
        create: { userId, clubeId: clube.id },
        update: {},
      });
      return membership;
    });

    return toClubeSummary({ ...membership, clube });
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
        user: {
          select: {
            name: true,
            email: true,
            document: true,
            phone: true,
            isGuest: true,
          },
        },
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
      select: {
        name: true,
        email: true,
        document: true,
        phone: true,
        isGuest: true,
      },
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
