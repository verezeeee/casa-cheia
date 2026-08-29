import type { CanActivate, ExecutionContext } from '@nestjs/common';
import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ClubeRole } from '@prisma/client';
import type { Request } from 'express';
import type { CurrentClubeContext } from '../../club/types/current-clube.type';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * Autorização por papel NO CLUBE da requisição. Lê `request.clube`, populado
 * pelo `ClubeMembershipGuard` — logo a cadeia correta é
 * `@UseGuards(JwtAuthGuard, ClubeMembershipGuard, RolesGuard)`, nesta ordem.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<ClubeRole[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required || required.length === 0) {
      return true;
    }

    const { clube } = context
      .switchToHttp()
      .getRequest<Request & { clube?: CurrentClubeContext }>();

    // Guard faltando na cadeia é BUG DE PROGRAMAÇÃO, não autorização negada:
    // devolver 403 aqui esconderia a rota mal configurada atrás de uma
    // resposta plausível, e ela só apareceria como "admin não consegue
    // acessar" muito depois. 500 quebra alto e cedo.
    if (!clube) {
      throw new InternalServerErrorException(
        '@Roles exige ClubeMembershipGuard antes na cadeia de guards.',
      );
    }

    if (!required.includes(clube.role)) {
      throw new ForbiddenException(
        'Você não tem permissão para executar esta ação neste clube.',
      );
    }

    return true;
  }
}
