import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import type { BlindStructureDto } from '@poker-system/shared';
import { ClubeRole } from '../generated/prisma';
import type { CurrentClubeContext } from '../club/types/current-clube.type';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BlindStructureController } from './blind-structure.controller';
import type { BlindStructureService } from './blind-structure.service';

const ADMIN: AuthenticatedUser = { id: 'admin-1', email: 'admin@b.dev' };

/** Papel vem do vínculo com o clube (`request.clube`), não do usuário. */
const AS_PLAYER: CurrentClubeContext = {
  id: 'clube-1',
  role: ClubeRole.PLAYER,
};
const AS_ADMIN: CurrentClubeContext = { id: 'clube-1', role: ClubeRole.ADMIN };

const STRUCTURE: BlindStructureDto = {
  id: 'bs-1',
  name: 'Turbo 20min',
  levels: [
    {
      levelNumber: 1,
      smallBlind: 25,
      bigBlind: 50,
      ante: 0,
      durationSeconds: 1200,
      isBreak: false,
      breakLabel: null,
    },
  ],
};

const DTO = { name: 'Turbo 20min', levels: [] } as never;

function buildController() {
  const blindStructureService: jest.Mocked<
    Pick<BlindStructureService, 'create' | 'list' | 'get' | 'update' | 'delete'>
  > = {
    create: jest.fn(),
    list: jest.fn(),
    get: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const controller = new BlindStructureController(
    blindStructureService as unknown as BlindStructureService,
  );
  return { controller, blindStructureService };
}

/** Contexto mínimo que o `RolesGuard` consome (handler + classe + request.clube). */
function contextFor(
  handler: (...args: never[]) => unknown,
  clube: CurrentClubeContext,
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => BlindStructureController,
    switchToHttp: () => ({ getRequest: () => ({ user: ADMIN, clube }) }),
  } as unknown as ExecutionContext;
}

const MUTATIONS = {
  create: BlindStructureController.prototype.create,
  update: BlindStructureController.prototype.update,
  delete: BlindStructureController.prototype.delete,
};
const READS = {
  list: BlindStructureController.prototype.list,
  get: BlindStructureController.prototype.get,
};

describe('BlindStructureController', () => {
  describe('guards e papéis', () => {
    it('o controller inteiro exige autenticação', () => {
      expect(
        Reflect.getMetadata(GUARDS_METADATA, BlindStructureController),
      ).toContain(JwtAuthGuard);
    });

    it.each(Object.entries(MUTATIONS))(
      '%s exige RolesGuard e recusa PLAYER com 403',
      (_name, handler) => {
        expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toContain(
          RolesGuard,
        );

        const guard = new RolesGuard(new Reflector());
        expect(() => guard.canActivate(contextFor(handler, AS_PLAYER))).toThrow(
          ForbiddenException,
        );
        expect(guard.canActivate(contextFor(handler, AS_ADMIN))).toBe(true);
      },
    );

    it.each(Object.entries(READS))(
      '%s é liberado a qualquer usuário autenticado',
      (_name, handler) => {
        const guard = new RolesGuard(new Reflector());
        expect(guard.canActivate(contextFor(handler, AS_PLAYER))).toBe(true);
      },
    );
  });

  describe('delegação', () => {
    it('create passa o id do admin', async () => {
      const { controller, blindStructureService } = buildController();
      blindStructureService.create.mockResolvedValue(STRUCTURE);

      await controller.create(ADMIN, DTO);
      expect(blindStructureService.create).toHaveBeenCalledWith(ADMIN.id, DTO);
    });

    it('list delega ao service', async () => {
      const { controller, blindStructureService } = buildController();
      blindStructureService.list.mockResolvedValue([STRUCTURE]);

      await expect(controller.list()).resolves.toEqual([STRUCTURE]);
    });

    it('get delega ao service', async () => {
      const { controller, blindStructureService } = buildController();
      blindStructureService.get.mockResolvedValue(STRUCTURE);

      await controller.get('bs-1');
      expect(blindStructureService.get).toHaveBeenCalledWith('bs-1');
    });

    it('update delega ao service', async () => {
      const { controller, blindStructureService } = buildController();
      blindStructureService.update.mockResolvedValue(STRUCTURE);

      await controller.update('bs-1', DTO);
      expect(blindStructureService.update).toHaveBeenCalledWith('bs-1', DTO);
    });

    it('delete delega ao service', async () => {
      const { controller, blindStructureService } = buildController();
      blindStructureService.delete.mockResolvedValue(undefined);

      await controller.delete('bs-1');
      expect(blindStructureService.delete).toHaveBeenCalledWith('bs-1');
    });
  });
});
