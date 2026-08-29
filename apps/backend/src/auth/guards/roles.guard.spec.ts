import type { ExecutionContext } from '@nestjs/common';
import {
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClubeRole } from '@prisma/client';
import type { CurrentClubeContext } from '../../club/types/current-clube.type';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { RolesGuard } from './roles.guard';

function buildContext(clube?: CurrentClubeContext): ExecutionContext {
  const request = { clube };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
  } as unknown as ExecutionContext;
}

/** Reflector real com a metadata que `@Roles(...)` gravaria no handler. */
function buildGuard(required?: ClubeRole[]): RolesGuard {
  const reflector = new Reflector();
  jest
    .spyOn(reflector, 'getAllAndOverride')
    .mockImplementation((key) => (key === ROLES_KEY ? required : undefined));
  return new RolesGuard(reflector);
}

describe('RolesGuard', () => {
  it('libera rota sem @Roles, mesmo sem clube na requisição', () => {
    expect(buildGuard(undefined).canActivate(buildContext())).toBe(true);
  });

  it('libera rota com @Roles() vazio', () => {
    expect(buildGuard([]).canActivate(buildContext())).toBe(true);
  });

  it('libera quando o papel NO CLUBE está entre os exigidos', () => {
    const context = buildContext({ id: 'clube-1', role: ClubeRole.ADMIN });

    expect(buildGuard([ClubeRole.ADMIN]).canActivate(context)).toBe(true);
  });

  it('nega (403) quando o papel no clube não está entre os exigidos', () => {
    const context = buildContext({ id: 'clube-1', role: ClubeRole.PLAYER });

    expect(() => buildGuard([ClubeRole.ADMIN]).canActivate(context)).toThrow(
      ForbiddenException,
    );
  });

  it('aceita qualquer um dos papéis listados', () => {
    const context = buildContext({ id: 'clube-1', role: ClubeRole.CASHIER });

    expect(
      buildGuard([ClubeRole.ADMIN, ClubeRole.CASHIER]).canActivate(context),
    ).toBe(true);
  });

  // O papel é do VÍNCULO, não da pessoa: um ADMIN do clube A não pode agir
  // como ADMIN no clube B só porque `request.user` é o mesmo.
  it('ignora qualquer `role` que ainda venha em request.user', () => {
    const context = buildContext();
    const request = context
      .switchToHttp()
      .getRequest<Record<string, unknown>>();
    request.user = { id: 'u1', email: 'a@b.dev', role: 'ADMIN' };

    expect(() => buildGuard([ClubeRole.ADMIN]).canActivate(context)).toThrow(
      InternalServerErrorException,
    );
  });

  it('explode (500) quando @Roles é usado sem ClubeMembershipGuard antes', () => {
    expect(() =>
      buildGuard([ClubeRole.ADMIN]).canActivate(buildContext()),
    ).toThrow(InternalServerErrorException);
  });
});
