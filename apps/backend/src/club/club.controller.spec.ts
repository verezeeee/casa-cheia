import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { ClubController } from './club.controller';
import type { ClubService } from './club.service';

// `AuthenticatedUser` não tem mais `role` (CL-BE-03) — papel vive no vínculo
// com o clube, não no token. `id`/`email` já cobrem o shape por completo.
const USER: AuthenticatedUser = { id: 'user-1', email: 'a@b.dev' };

function buildController() {
  const clubService: jest.Mocked<
    Pick<
      ClubService,
      | 'listMyClubes'
      | 'createClube'
      | 'joinByCode'
      | 'getClube'
      | 'listMembers'
      | 'upsertMember'
    >
  > = {
    listMyClubes: jest.fn(),
    createClube: jest.fn(),
    joinByCode: jest.fn(),
    getClube: jest.fn(),
    listMembers: jest.fn(),
    upsertMember: jest.fn(),
  };
  const controller = new ClubController(clubService as unknown as ClubService);
  return { controller, clubService };
}

describe('ClubController', () => {
  it('listMyClubes usa o id do usuário autenticado', async () => {
    const { controller, clubService } = buildController();
    clubService.listMyClubes.mockResolvedValue([]);

    await expect(controller.listMyClubes(USER)).resolves.toEqual([]);
    expect(clubService.listMyClubes).toHaveBeenCalledWith('user-1');
  });

  it('createClube repassa usuário e corpo validado', async () => {
    const { controller, clubService } = buildController();
    const dto = { name: 'Casa Cheia', document: '12345678000199' };

    await controller.createClube(USER, dto);
    expect(clubService.createClube).toHaveBeenCalledWith('user-1', dto);
  });

  it('joinByCode repassa usuário e código', async () => {
    const { controller, clubService } = buildController();
    const dto = { code: '123456' };

    await controller.joinByCode(USER, dto);
    expect(clubService.joinByCode).toHaveBeenCalledWith('user-1', dto);
  });

  it('getClube repassa usuário e clubeId', async () => {
    const { controller, clubService } = buildController();

    await controller.getClube(USER, 'clube-1');
    expect(clubService.getClube).toHaveBeenCalledWith('user-1', 'clube-1');
  });

  it('listMembers repassa usuário e clubeId (checagem de ADMIN é do service)', async () => {
    const { controller, clubService } = buildController();

    await controller.listMembers(USER, 'clube-1');
    expect(clubService.listMembers).toHaveBeenCalledWith('user-1', 'clube-1');
  });

  it('upsertMember repassa o corpo validado', async () => {
    const { controller, clubService } = buildController();
    const dto = { userId: 'user-2', role: 'CASHIER' as const };

    await controller.upsertMember(USER, 'clube-1', dto);
    expect(clubService.upsertMember).toHaveBeenCalledWith(
      'user-1',
      'clube-1',
      dto,
    );
  });
});
