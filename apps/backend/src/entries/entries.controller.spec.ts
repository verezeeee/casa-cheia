import { ClubeRole } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import type { CurrentClubeContext } from '../club/types/current-clube.type';
import { EntriesController } from './entries.controller';
import type { EntriesService } from './entries.service';

const CLUBE_ID = 'clube-1';
const USER: AuthenticatedUser = { id: 'user-1', email: 'a@b.dev' };

function buildController() {
  const entriesService: jest.Mocked<Pick<EntriesService, 'listEntries'>> = {
    listEntries: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
  };
  const controller = new EntriesController(
    entriesService as unknown as EntriesService,
  );
  return { controller, entriesService };
}

describe('EntriesController', () => {
  it('ADMIN: passa userId null (vê o clube inteiro)', async () => {
    const { controller, entriesService } = buildController();
    const clube: CurrentClubeContext = { id: CLUBE_ID, role: ClubeRole.ADMIN };

    await controller.list(CLUBE_ID, USER, clube, {});

    expect(entriesService.listEntries).toHaveBeenCalledWith(
      CLUBE_ID,
      null,
      undefined,
      undefined,
    );
  });

  it('PLAYER: passa o próprio userId (só vê as próprias entradas)', async () => {
    const { controller, entriesService } = buildController();
    const clube: CurrentClubeContext = { id: CLUBE_ID, role: ClubeRole.PLAYER };

    await controller.list(CLUBE_ID, USER, clube, { cursor: 'abc', limit: 10 });

    expect(entriesService.listEntries).toHaveBeenCalledWith(
      CLUBE_ID,
      USER.id,
      'abc',
      10,
    );
  });
});
