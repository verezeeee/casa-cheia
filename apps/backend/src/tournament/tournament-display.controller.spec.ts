import { TournamentClockStatus } from '@poker-system/shared';
import type { TournamentClockService } from './tournament-clock.service';
import { TournamentDisplayController } from './tournament-display.controller';
import type { TournamentTableRow } from './tournament.mappers';
import { toPublicTournamentTableMapDto } from './tournament.mappers';
import type { TournamentService } from './tournament.service';

/** Linha crua do banco — com `userId`, que é justamente o que não pode vazar. */
const TABLE_ROW: TournamentTableRow = {
  id: 'tbl-1',
  tableNumber: 1,
  capacity: 9,
  status: 'OPEN',
  seats: [
    {
      seatNumber: 3,
      tournamentEntry: {
        id: 'entry-1',
        userId: 'user-secreto-1',
        chipStack: 12_500,
        user: { name: 'Jogador Um' },
      },
    },
    {
      seatNumber: 1,
      tournamentEntry: {
        id: 'entry-2',
        userId: 'user-secreto-2',
        chipStack: 7_500,
        user: { name: 'Jogador Dois' },
      },
    },
  ],
};

const CLOCK = {
  clockStatus: TournamentClockStatus.RUNNING,
  currentLevel: null,
  nextLevel: null,
  levelEndsAt: new Date().toISOString(),
  remainingMs: 60_000,
  serverTime: new Date().toISOString(),
};

function buildController() {
  const tournamentService: jest.Mocked<
    Pick<TournamentService, 'readPublicTableMap'>
  > = {
    readPublicTableMap: jest
      .fn()
      .mockResolvedValue(toPublicTournamentTableMapDto('trn-1', [TABLE_ROW])),
  };
  const clockService: jest.Mocked<Pick<TournamentClockService, 'read'>> = {
    read: jest.fn().mockResolvedValue(CLOCK),
  };
  const controller = new TournamentDisplayController(
    tournamentService as unknown as TournamentService,
    clockService as unknown as TournamentClockService,
  );
  return { controller, tournamentService, clockService };
}

describe('TournamentDisplayController', () => {
  it('getClock delega ao clock service', async () => {
    const { controller, clockService } = buildController();

    await expect(controller.getClock('trn-1')).resolves.toEqual(CLOCK);
    expect(clockService.read).toHaveBeenCalledWith('trn-1');
  });

  it('getTables devolve nome, assento e fichas, em ordem de assento', async () => {
    const { controller } = buildController();

    const map = await controller.getTables('trn-1');
    expect(map).toMatchObject({
      tournamentId: 'trn-1',
      playersRemaining: 2,
      averageStack: 10_000,
    });
    expect(map.tables[0].seats).toEqual([
      {
        entryId: 'entry-2',
        userName: 'Jogador Dois',
        seatNumber: 1,
        chipStack: 7_500,
      },
      {
        entryId: 'entry-1',
        userName: 'Jogador Um',
        seatNumber: 3,
        chipStack: 12_500,
      },
    ]);
  });

  // Teste NEGATIVO sobre o JSON serializado, não sobre o tipo: `Omit<>` some
  // na compilação, e um `as any` no meio do caminho passaria batido.
  it('não serializa userId em lugar nenhum do payload público', async () => {
    const { controller } = buildController();

    const body = JSON.stringify(await controller.getTables('trn-1'));
    expect(body).not.toContain('userId');
    expect(body).not.toContain('user-secreto-1');
    expect(body).not.toContain('user-secreto-2');
    expect(body).not.toContain('email');
  });

  it('mapper público não vaza campo novo do assento sem alguém autorizar', () => {
    const withExtra = {
      ...TABLE_ROW,
      seats: [
        {
          ...TABLE_ROW.seats[0],
          tournamentEntry: {
            ...TABLE_ROW.seats[0].tournamentEntry,
            // Campo sensível "adicionado no futuro" à consulta.
            user: { name: 'Jogador Um', email: 'jogador@clube.test' },
          },
        },
      ],
    } as unknown as TournamentTableRow;

    const body = JSON.stringify(
      toPublicTournamentTableMapDto('trn-1', [withExtra]),
    );
    expect(body).not.toContain('jogador@clube.test');
  });
});
