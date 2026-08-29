import type { CanActivate, ExecutionContext } from '@nestjs/common';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import { PrismaService } from '../../prisma/prisma.service';
import type { CurrentClubeContext } from '../types/current-clube.type';

/**
 * Resolve o clube da requisição (`:clubeId` da rota) e o papel do usuário
 * autenticado nele. Roda DEPOIS do `JwtAuthGuard` e ANTES do `RolesGuard`:
 * `@UseGuards(JwtAuthGuard, ClubeMembershipGuard, RolesGuard)`.
 *
 * SEM VÍNCULO ATIVO → 404, NÃO 403. Um 403 confirmaria que aquele clube
 * existe: um id enumerado por quem não é membro viraria um oráculo de
 * existência de tenants. Para quem não tem acesso, o clube simplesmente não
 * existe — mesma resposta de um uuid inventado.
 *
 * Clube `SUSPENDED`/`CANCELLED` também cai no 404: bloqueio operacional do
 * tenant (o dado continua no banco para trilha financeira, ver club.prisma).
 */
@Injectable()
export class ClubeMembershipGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<
      Request & {
        user?: AuthenticatedUser;
        clube?: CurrentClubeContext;
      }
    >();

    const clubeId = request.params?.clubeId;

    // Malformado é erro do CLIENTE (400), não "não encontrado": sem esta
    // checagem, um id não-uuid explodiria como erro de driver no Postgres.
    if (typeof clubeId !== 'string' || !isUUID(clubeId)) {
      throw new BadRequestException(
        'Identificador de clube inválido: esperado um UUID.',
      );
    }

    if (!request.user) {
      throw new NotFoundException('Clube não encontrado.');
    }

    const membership = await this.prisma.clubeMembership.findUnique({
      where: { clubeId_userId: { clubeId, userId: request.user.id } },
      select: {
        role: true,
        status: true,
        clube: { select: { status: true } },
      },
    });

    if (
      !membership ||
      membership.status !== 'ACTIVE' ||
      membership.clube.status !== 'ACTIVE'
    ) {
      throw new NotFoundException('Clube não encontrado.');
    }

    request.clube = { id: clubeId, role: membership.role };
    return true;
  }
}
