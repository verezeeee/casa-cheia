import { BadRequestException } from '@nestjs/common';
import { TableStatus, TableType } from '@poker-system/shared';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { TableController } from './table.controller';
import type { TableService } from './table.service';

const PLAYER: AuthenticatedUser = {
  id: 'user-1',
  email: 'a@b.dev',
  role: 'PLAYER',
};
const ADMIN: AuthenticatedUser = {
  id: 'admin-1',
  email: 'admin@b.dev',
  role: 'ADMIN',
};

const SEAT = {
  seatNumber: 1,
  userId: 'user-1',
  userName: 'Jogador',
  currentStack: '100.00',
  sessionId: 'session-1',
};

function buildController() {
  const tableService: jest.Mocked<
    Pick<
      TableService,
      | 'createTable'
      | 'listTables'
      | 'getSeats'
      | 'sitAtTable'
      | 'cashOut'
      | 'recordMovement'
    >
  > = {
    createTable: jest.fn(),
    listTables: jest.fn(),
    getSeats: jest.fn(),
    sitAtTable: jest.fn(),
    cashOut: jest.fn(),
    recordMovement: jest.fn(),
  };
  const controller = new TableController(
    tableService as unknown as TableService,
  );
  return { controller, tableService };
}

describe('TableController', () => {
  it('createTable delega ao service com o id do admin', async () => {
    const { controller, tableService } = buildController();
    tableService.createTable.mockResolvedValue({
      id: 'table-1',
      name: 'Mesa',
      type: TableType.CASH_GAME,
      smallBlind: '1.00',
      bigBlind: '2.00',
      minBuyIn: '40.00',
      maxBuyIn: '200.00',
      maxSeats: 6,
      occupiedSeats: 0,
      status: TableStatus.OPEN,
    });

    const dto = {
      name: 'Mesa',
      type: 'CASH_GAME',
      smallBlind: '1.00',
      bigBlind: '2.00',
      minBuyIn: '40.00',
      maxBuyIn: '200.00',
      maxSeats: 6,
    } as never;
    await controller.createTable(ADMIN, dto);
    expect(tableService.createTable).toHaveBeenCalledWith(ADMIN.id, dto);
  });

  it('listTables repassa cursor e limit', async () => {
    const { controller, tableService } = buildController();
    tableService.listTables.mockResolvedValue({ items: [], nextCursor: null });

    await controller.listTables({ cursor: 'abc', limit: 5 });
    expect(tableService.listTables).toHaveBeenCalledWith('abc', 5);
  });

  it('getSeats delega ao service', async () => {
    const { controller, tableService } = buildController();
    tableService.getSeats.mockResolvedValue([SEAT]);

    await expect(controller.getSeats('table-1')).resolves.toEqual([SEAT]);
    expect(tableService.getSeats).toHaveBeenCalledWith('table-1');
  });

  describe('sitAtTable', () => {
    it('exige Idempotency-Key', async () => {
      const { controller } = buildController();
      await expect(
        controller.sitAtTable(
          PLAYER,
          'table-1',
          { seatNumber: 1, buyInAmount: '50.00' },
          undefined,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('delega ao service com o id do jogador', async () => {
      const { controller, tableService } = buildController();
      tableService.sitAtTable.mockResolvedValue(SEAT);

      const dto = { seatNumber: 1, buyInAmount: '50.00' };
      await controller.sitAtTable(PLAYER, 'table-1', dto, 'idem-1');
      expect(tableService.sitAtTable).toHaveBeenCalledWith(
        PLAYER.id,
        'table-1',
        dto,
        'idem-1',
      );
    });
  });

  describe('cashOut', () => {
    it('exige Idempotency-Key', async () => {
      const { controller } = buildController();
      await expect(
        controller.cashOut(PLAYER, 'table-1', 'session-1', undefined),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('delega ao service', async () => {
      const { controller, tableService } = buildController();
      tableService.cashOut.mockResolvedValue({
        ...SEAT,
        userId: null,
        userName: null,
        currentStack: null,
      });

      await controller.cashOut(PLAYER, 'table-1', 'session-1', 'idem-2');
      expect(tableService.cashOut).toHaveBeenCalledWith(
        PLAYER.id,
        'table-1',
        'session-1',
        'idem-2',
      );
    });
  });

  it('recordMovement delega ao service com o id do admin', async () => {
    const { controller, tableService } = buildController();
    tableService.recordMovement.mockResolvedValue(SEAT);

    const dto = { amount: '20.00', reason: 'HAND_RESULT' } as never;
    await controller.recordMovement(ADMIN, 'table-1', 'session-1', dto);
    expect(tableService.recordMovement).toHaveBeenCalledWith(
      ADMIN.id,
      'table-1',
      'session-1',
      dto,
    );
  });
});
