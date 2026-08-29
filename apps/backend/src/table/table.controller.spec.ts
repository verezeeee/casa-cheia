import { BadRequestException } from '@nestjs/common';
import { TableStatus, TableType } from '@poker-system/shared';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { TableController } from './table.controller';
import type { TableService } from './table.service';

const PLAYER: AuthenticatedUser = {
  id: 'user-1',
  email: 'a@b.dev',
};
const ADMIN: AuthenticatedUser = {
  id: 'admin-1',
  email: 'admin@b.dev',
};
const CLUBE_ID = 'clube-1';

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
  it('createTable delega ao service com o id do admin e o clube da rota', async () => {
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
    await controller.createTable(ADMIN, CLUBE_ID, dto);
    expect(tableService.createTable).toHaveBeenCalledWith(
      ADMIN.id,
      CLUBE_ID,
      dto,
    );
  });

  it('listTables repassa clubeId, cursor e limit', async () => {
    const { controller, tableService } = buildController();
    tableService.listTables.mockResolvedValue({ items: [], nextCursor: null });

    await controller.listTables(CLUBE_ID, { cursor: 'abc', limit: 5 });
    expect(tableService.listTables).toHaveBeenCalledWith(CLUBE_ID, 'abc', 5);
  });

  it('getSeats delega ao service com o clube da rota', async () => {
    const { controller, tableService } = buildController();
    tableService.getSeats.mockResolvedValue([SEAT]);

    await expect(controller.getSeats(CLUBE_ID, 'table-1')).resolves.toEqual([
      SEAT,
    ]);
    expect(tableService.getSeats).toHaveBeenCalledWith(CLUBE_ID, 'table-1');
  });

  describe('sitAtTable', () => {
    it('exige Idempotency-Key', async () => {
      const { controller } = buildController();
      await expect(
        controller.sitAtTable(
          PLAYER,
          CLUBE_ID,
          'table-1',
          { seatNumber: 1, buyInAmount: '50.00' },
          undefined,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('delega ao service com o id do jogador e o clube da rota', async () => {
      const { controller, tableService } = buildController();
      tableService.sitAtTable.mockResolvedValue(SEAT);

      const dto = { seatNumber: 1, buyInAmount: '50.00' };
      await controller.sitAtTable(PLAYER, CLUBE_ID, 'table-1', dto, 'idem-1');
      expect(tableService.sitAtTable).toHaveBeenCalledWith(
        PLAYER.id,
        CLUBE_ID,
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
        controller.cashOut(PLAYER, CLUBE_ID, 'table-1', 'session-1', undefined),
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

      await controller.cashOut(
        PLAYER,
        CLUBE_ID,
        'table-1',
        'session-1',
        'idem-2',
      );
      expect(tableService.cashOut).toHaveBeenCalledWith(
        PLAYER.id,
        CLUBE_ID,
        'table-1',
        'session-1',
        'idem-2',
      );
    });
  });

  it('recordMovement delega ao service com o id do admin e o clube da rota', async () => {
    const { controller, tableService } = buildController();
    tableService.recordMovement.mockResolvedValue(SEAT);

    const dto = { amount: '20.00', reason: 'HAND_RESULT' } as never;
    await controller.recordMovement(
      ADMIN,
      CLUBE_ID,
      'table-1',
      'session-1',
      dto,
    );
    expect(tableService.recordMovement).toHaveBeenCalledWith(
      ADMIN.id,
      CLUBE_ID,
      'table-1',
      'session-1',
      dto,
    );
  });
});
