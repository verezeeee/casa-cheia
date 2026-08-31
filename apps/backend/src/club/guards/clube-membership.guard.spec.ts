import type { ExecutionContext } from '@nestjs/common';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ClubeRole } from '../../generated/prisma';
import type { PrismaService } from '../../prisma/prisma.service';
import { ClubeMembershipGuard } from './clube-membership.guard';

const CLUBE_ID = '11111111-1111-4111-8111-111111111111';
const USER = { id: '22222222-2222-4222-8222-222222222222', email: 'a@b.dev' };

type Request = {
  params: Record<string, string>;
  user?: typeof USER;
  clube?: { id: string; role: ClubeRole };
};

function buildContext(
  params: Record<string, string> = { clubeId: CLUBE_ID },
  options: { anonymous?: boolean } = {},
): { context: ExecutionContext; request: Request } {
  const request: Request = {
    params,
    user: options.anonymous ? undefined : USER,
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

function buildGuard(membership: unknown) {
  const findUnique = jest.fn().mockResolvedValue(membership);
  const prisma = {
    clubeMembership: { findUnique },
  } as unknown as PrismaService;
  return { guard: new ClubeMembershipGuard(prisma), findUnique };
}

const ACTIVE_MEMBERSHIP = {
  role: ClubeRole.CASHIER,
  status: 'ACTIVE',
  clube: { status: 'ACTIVE' },
};

describe('ClubeMembershipGuard', () => {
  it('libera e popula request.clube quando a membership está ACTIVE', async () => {
    const { guard, findUnique } = buildGuard(ACTIVE_MEMBERSHIP);
    const { context, request } = buildContext();

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.clube).toEqual({ id: CLUBE_ID, role: ClubeRole.CASHIER });
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clubeId_userId: { clubeId: CLUBE_ID, userId: USER.id } },
      }),
    );
  });

  it('devolve 400 quando o clubeId não é um UUID', async () => {
    const { guard, findUnique } = buildGuard(ACTIVE_MEMBERSHIP);
    const { context } = buildContext({ clubeId: 'nao-e-uuid' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    // Nem chega a consultar o banco com um id malformado.
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('devolve 400 quando a rota não tem :clubeId', async () => {
    const { guard } = buildGuard(ACTIVE_MEMBERSHIP);

    await expect(
      guard.canActivate(buildContext({}).context),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // 404 e NÃO 403 nos três casos abaixo: um 403 confirmaria a existência do
  // clube para quem não tem acesso a ele.
  it('devolve 404 quando não existe membership', async () => {
    const { guard } = buildGuard(null);

    await expect(
      guard.canActivate(buildContext().context),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('devolve 404 quando a membership está REVOKED', async () => {
    const { guard } = buildGuard({ ...ACTIVE_MEMBERSHIP, status: 'REVOKED' });

    await expect(
      guard.canActivate(buildContext().context),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('devolve 404 quando o clube está SUSPENDED', async () => {
    const { guard } = buildGuard({
      ...ACTIVE_MEMBERSHIP,
      clube: { status: 'SUSPENDED' },
    });

    await expect(
      guard.canActivate(buildContext().context),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('devolve 404 quando não há usuário autenticado na requisição', async () => {
    const { guard, findUnique } = buildGuard(ACTIVE_MEMBERSHIP);

    await expect(
      guard.canActivate(
        buildContext({ clubeId: CLUBE_ID }, { anonymous: true }).context,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(findUnique).not.toHaveBeenCalled();
  });
});
