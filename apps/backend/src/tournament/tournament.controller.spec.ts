import { BadRequestException } from '@nestjs/common';
import {
  TournamentClockStatus,
  TournamentEntryStatus,
  TournamentStatus,
} from '@poker-system/shared';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import type { TournamentClockService } from './tournament-clock.service';
import { TournamentController } from './tournament.controller';
import type { TournamentService } from './tournament.service';

const CLUBE_ID = 'clube-1';

const PLAYER: AuthenticatedUser = {
  id: 'user-1',
  email: 'a@b.dev',
};
const ADMIN: AuthenticatedUser = {
  id: 'admin-1',
  email: 'admin@b.dev',
};

const ENTRY = {
  id: 'entry-1',
  userId: 'user-1',
  userName: 'Jogador',
  status: TournamentEntryStatus.REGISTERED,
  chipStack: 10_000,
  staffBonusPaid: false,
  finalPosition: null,
  prizeAmount: null,
  tableNumber: null,
  seatNumber: null,
};

const CLOCK = {
  clockStatus: TournamentClockStatus.RUNNING,
  currentLevel: null,
  nextLevel: null,
  levelEndsAt: null,
  remainingMs: 0,
  serverTime: new Date().toISOString(),
};

function buildController() {
  const tournamentService: jest.Mocked<
    Pick<
      TournamentService,
      | 'createTournament'
      | 'updateTournament'
      | 'listTournaments'
      | 'getTournament'
      | 'registerEntry'
      | 'unregisterEntry'
      | 'eliminateEntry'
      | 'finishTournament'
    >
  > = {
    createTournament: jest.fn(),
    updateTournament: jest.fn(),
    listTournaments: jest.fn(),
    getTournament: jest.fn(),
    registerEntry: jest.fn(),
    unregisterEntry: jest.fn(),
    eliminateEntry: jest.fn(),
    finishTournament: jest.fn(),
  };
  const clockService: jest.Mocked<
    Pick<
      TournamentClockService,
      'start' | 'pause' | 'resume' | 'next' | 'previous' | 'updateLevel'
    >
  > = {
    start: jest.fn().mockResolvedValue(CLOCK),
    pause: jest.fn().mockResolvedValue(CLOCK),
    resume: jest.fn().mockResolvedValue(CLOCK),
    next: jest.fn().mockResolvedValue(CLOCK),
    previous: jest.fn().mockResolvedValue(CLOCK),
    updateLevel: jest.fn().mockResolvedValue(CLOCK),
  };
  const controller = new TournamentController(
    tournamentService as unknown as TournamentService,
    clockService as unknown as TournamentClockService,
  );
  return { controller, tournamentService, clockService };
}

describe('TournamentController', () => {
  it('createTournament delega ao service com o id do admin', async () => {
    const { controller, tournamentService } = buildController();
    tournamentService.createTournament.mockResolvedValue({
      id: 'trn-1',
      name: 'Sunday Major',
      buyIn: '90.00',
      fee: '10.00',
      staffBonusCost: null,
      staffBonusChips: null,
      maxPlayers: 100,
      registeredPlayers: 0,
      status: TournamentStatus.REGISTERING,
      startsAt: new Date().toISOString(),
    });

    const dto = { name: 'Sunday Major', prizes: [] } as never;
    await controller.createTournament(ADMIN, CLUBE_ID, dto);
    expect(tournamentService.createTournament).toHaveBeenCalledWith(
      ADMIN.id,
      CLUBE_ID,
      dto,
    );
  });

  it('updateTournament delega ao service', async () => {
    const { controller, tournamentService } = buildController();
    tournamentService.updateTournament.mockResolvedValue({
      id: 'trn-1',
      name: 'Sunday Major (editado)',
      buyIn: '90.00',
      fee: '10.00',
      staffBonusCost: null,
      staffBonusChips: null,
      maxPlayers: 100,
      registeredPlayers: 0,
      status: TournamentStatus.REGISTERING,
      startsAt: new Date().toISOString(),
    });

    const dto = { name: 'Sunday Major (editado)' };
    await controller.updateTournament(CLUBE_ID, 'trn-1', dto);
    expect(tournamentService.updateTournament).toHaveBeenCalledWith(
      CLUBE_ID,
      'trn-1',
      dto,
    );
  });

  it('listTournaments repassa cursor e limit', async () => {
    const { controller, tournamentService } = buildController();
    tournamentService.listTournaments.mockResolvedValue({
      items: [],
      nextCursor: null,
    });

    await controller.listTournaments(CLUBE_ID, { cursor: 'abc', limit: 5 });
    expect(tournamentService.listTournaments).toHaveBeenCalledWith(
      CLUBE_ID,
      'abc',
      5,
    );
  });

  it('getTournament delega ao service', async () => {
    const { controller, tournamentService } = buildController();
    tournamentService.getTournament.mockResolvedValue({
      id: 'trn-1',
      name: 'Sunday Major',
      buyIn: '90.00',
      fee: '10.00',
      staffBonusCost: null,
      staffBonusChips: null,
      maxPlayers: 100,
      registeredPlayers: 1,
      status: TournamentStatus.REGISTERING,
      startsAt: new Date().toISOString(),
      startingStack: 10_000,
      tableCapacity: 9,
      lateRegUntil: null,
      guaranteedPrize: null,
      blindStructureId: null,
      allowReentry: false,
      maxReentries: null,
      reentryUntilLevel: null,
      prizes: [],
      entries: [],
    });

    await controller.getTournament(CLUBE_ID, 'trn-1');
    expect(tournamentService.getTournament).toHaveBeenCalledWith(
      CLUBE_ID,
      'trn-1',
    );
  });

  describe('register', () => {
    it('exige Idempotency-Key', async () => {
      const { controller } = buildController();
      await expect(
        controller.register(PLAYER, CLUBE_ID, 'trn-1', undefined, {}),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('delega ao service com o id do jogador', async () => {
      const { controller, tournamentService } = buildController();
      tournamentService.registerEntry.mockResolvedValue(ENTRY);

      await controller.register(PLAYER, CLUBE_ID, 'trn-1', 'idem-1', {});
      expect(tournamentService.registerEntry).toHaveBeenCalledWith(
        PLAYER.id,
        CLUBE_ID,
        'trn-1',
        'idem-1',
        false,
      );
    });

    it('repassa staffBonus: true ao service', async () => {
      const { controller, tournamentService } = buildController();
      tournamentService.registerEntry.mockResolvedValue({
        ...ENTRY,
        staffBonusPaid: true,
      });

      await controller.register(PLAYER, CLUBE_ID, 'trn-1', 'idem-1', {
        staffBonus: true,
      });
      expect(tournamentService.registerEntry).toHaveBeenCalledWith(
        PLAYER.id,
        CLUBE_ID,
        'trn-1',
        'idem-1',
        true,
      );
    });
  });

  describe('unregister', () => {
    it('exige Idempotency-Key', async () => {
      const { controller } = buildController();
      await expect(
        controller.unregister(PLAYER, CLUBE_ID, 'trn-1', undefined),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('delega ao service com o id de quem chama', async () => {
      const { controller, tournamentService } = buildController();
      tournamentService.unregisterEntry.mockResolvedValue({
        ...ENTRY,
        status: TournamentEntryStatus.REFUNDED,
      });

      await controller.unregister(PLAYER, CLUBE_ID, 'trn-1', 'idem-1');
      expect(tournamentService.unregisterEntry).toHaveBeenCalledWith(
        PLAYER.id,
        CLUBE_ID,
        'trn-1',
        'idem-1',
      );
    });
  });

  describe('unregisterForUser (admin)', () => {
    it('exige Idempotency-Key', async () => {
      const { controller } = buildController();
      await expect(
        controller.unregisterForUser(
          CLUBE_ID,
          'trn-1',
          'other-user',
          undefined,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('delega ao service com o id do ALVO, não de quem chama', async () => {
      const { controller, tournamentService } = buildController();
      tournamentService.unregisterEntry.mockResolvedValue({
        ...ENTRY,
        status: TournamentEntryStatus.REFUNDED,
      });

      await controller.unregisterForUser(
        CLUBE_ID,
        'trn-1',
        'other-user',
        'idem-1',
      );
      expect(tournamentService.unregisterEntry).toHaveBeenCalledWith(
        'other-user',
        CLUBE_ID,
        'trn-1',
        'idem-1',
      );
    });
  });

  describe('registerForUser (admin)', () => {
    it('exige Idempotency-Key', async () => {
      const { controller } = buildController();
      await expect(
        controller.registerForUser(
          CLUBE_ID,
          'trn-1',
          'other-user',
          undefined,
          {},
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('delega ao service com o id do ALVO, não de quem chama', async () => {
      const { controller, tournamentService } = buildController();
      tournamentService.registerEntry.mockResolvedValue(ENTRY);

      await controller.registerForUser(
        CLUBE_ID,
        'trn-1',
        'other-user',
        'idem-1',
        {
          staffBonus: true,
        },
      );
      expect(tournamentService.registerEntry).toHaveBeenCalledWith(
        'other-user',
        CLUBE_ID,
        'trn-1',
        'idem-1',
        true,
      );
    });
  });

  it('eliminate delega ao service', async () => {
    const { controller, tournamentService } = buildController();
    tournamentService.eliminateEntry.mockResolvedValue({
      ...ENTRY,
      status: TournamentEntryStatus.ELIMINATED,
    });

    const dto = { finalPosition: 4 };
    await controller.eliminate(CLUBE_ID, 'trn-1', 'entry-1', dto);
    expect(tournamentService.eliminateEntry).toHaveBeenCalledWith(
      CLUBE_ID,
      'trn-1',
      'entry-1',
      dto,
    );
  });

  it('finish delega ao service', async () => {
    const { controller, tournamentService } = buildController();
    tournamentService.finishTournament.mockResolvedValue({
      id: 'trn-1',
      name: 'Sunday Major',
      buyIn: '90.00',
      fee: '10.00',
      staffBonusCost: null,
      staffBonusChips: null,
      maxPlayers: 100,
      registeredPlayers: 1,
      status: TournamentStatus.FINISHED,
      startsAt: new Date().toISOString(),
      startingStack: 10_000,
      tableCapacity: 9,
      lateRegUntil: null,
      guaranteedPrize: null,
      blindStructureId: null,
      allowReentry: false,
      maxReentries: null,
      reentryUntilLevel: null,
      prizes: [],
      entries: [],
    });

    await controller.finish(CLUBE_ID, 'trn-1');
    expect(tournamentService.finishTournament).toHaveBeenCalledWith(
      CLUBE_ID,
      'trn-1',
    );
  });

  describe('relógio', () => {
    it.each([
      ['startClock', 'start'],
      ['pauseClock', 'pause'],
      ['resumeClock', 'resume'],
      ['nextLevel', 'next'],
      ['previousLevel', 'previous'],
    ] as const)('%s delega ao clock service', async (route, method) => {
      const { controller, clockService } = buildController();

      const result = await controller[route](CLUBE_ID, 'trn-1');

      expect(clockService[method]).toHaveBeenCalledWith(CLUBE_ID, 'trn-1');
      expect(result).toBe(CLOCK);
    });

    it('updateBlindLevel repassa torneio, nível e payload', async () => {
      const { controller, clockService } = buildController();
      const dto = { durationSeconds: 900 };

      await controller.updateBlindLevel(CLUBE_ID, 'trn-1', 3, dto);

      expect(clockService.updateLevel).toHaveBeenCalledWith(
        CLUBE_ID,
        'trn-1',
        3,
        dto,
      );
    });
  });
});
