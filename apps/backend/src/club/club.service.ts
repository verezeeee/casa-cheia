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
import type { Clube, ClubeMembership } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { UpsertClubeMembershipDto } from './dto/upsert-clube-membership.dto';

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
  membership: ClubeMembership & { user: { name: string; email: string } },
): ClubeMembershipDto {
  return {
    id: membership.id,
    userId: membership.userId,
    name: membership.user.name,
    email: membership.user.email,
    role: membership.role as unknown as SharedClubeRole,
    status: membership.status as unknown as SharedClubeMembershipStatus,
    createdAt: membership.createdAt.toISOString(),
  };
}

@Injectable()
export class ClubService {
  constructor(private readonly prisma: PrismaService) {}

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
      include: { user: { select: { name: true, email: true } } },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    });

    return memberships.map(toMembershipDto);
  }

  async upsertMember(
    userId: string,
    clubeId: string,
    dto: UpsertClubeMembershipDto,
  ): Promise<ClubeMembershipDto> {
    await this.requireAdmin(userId, clubeId);

    const status = dto.status ?? 'ACTIVE';

    // Trava anti-lockout: sem ela, o único admin do clube consegue se
    // rebaixar/revogar e ninguém mais consegue administrar o clube — a
    // recuperação exigiria acesso direto ao banco (não há super-admin, ADR-0001).
    if (
      dto.userId === userId &&
      (dto.role !== 'ADMIN' || status !== 'ACTIVE')
    ) {
      throw new BadRequestException(
        'Um administrador não pode remover o próprio acesso ao clube.',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
      select: { name: true, email: true },
    });
    if (!user) throw new NotFoundException('Usuário não encontrado.');

    const membership = await this.prisma.clubeMembership.upsert({
      where: { clubeId_userId: { clubeId, userId: dto.userId } },
      create: { clubeId, userId: dto.userId, role: dto.role, status },
      update: { role: dto.role, status },
    });

    return toMembershipDto({ ...membership, user });
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
