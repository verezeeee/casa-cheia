import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { WalletService } from '../wallet/wallet.service';
import { TournamentService } from './tournament.service';

const CLUBE_ID = 'clube-1';

const TOURNAMENT = {
  id: 'trn-1',
  name: 'Sunday Major',
  buyIn: new Prisma.Decimal('90.00'),
  fee: new Prisma.Decimal('10.00'),
  staffBonusCost: null,
  staffBonusChips: null,
  startingStack: 10_000,
  maxPlayers: 4,
  tableCapacity: 9,
  status: 'REGISTERING',
  registrationOpensAt: null,
  startsAt: new Date('2026-02-01T21:00:00.000Z'),
  lateRegUntil: null,
  finishedAt: null,
  prizePool: new Prisma.Decimal('180.00'),
  guaranteedPrize: null,
  createdById: 'admin-1',
  allowReentry: false,
  maxReentries: null,
  reentryUntilLevel: null,
  currentLevelNumber: null,
  version: 3,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

const WALLET = { id: 'wallet-1', userId: 'user-1' };

const ENTRY_ROW = {
  id: 'entry-1',
  userId: 'user-1',
  status: 'REGISTERED',
  chipStack: 10_000,
  finalPosition: null,
  prizeAmount: null,
  user: { name: 'Jogador' },
  seats: [] as Array<{
    seatNumber: number;
    tournamentTable: { tableNumber: number };
  }>,
};

/** Uma linha de `readTables` (shape de `TABLE_SELECT`). */
function tableRow(
  tableNumber: number,
  capacity: number,
  entryIds: string[],
  status: 'OPEN' | 'CLOSED' = 'OPEN',
) {
  return {
    id: `table-${tableNumber}`,
    tableNumber,
    capacity,
    status,
    seats: entryIds.map((entryId, index) => ({
      seatNumber: index + 1,
      tournamentEntry: {
        id: entryId,
        userId: `user-${entryId}`,
        chipStack: 1000,
        user: { name: entryId },
      },
    })),
  };
}

function uniqueError(target: string | string[]) {
  return new Prisma.PrismaClientKnownRequestError('duplicate', {
    code: 'P2002',
    clientVersion: '6.19.3',
    meta: { target },
  });
}

function buildPrisma() {
  // MT-QA-01: a inscrição passou a ler torneio/contagens DENTRO da transação,
  // sob o lock pessimista. Estes mocks são COMPARTILHADOS entre o client de
  // fora e o `tx` justamente para que um teste continue configurando "o que o
  // banco responde" num lugar só, sem se importar com o lado do lock em que a
  // leitura acontece.
  const shared = {
    tournamentRead: jest.fn().mockResolvedValue(TOURNAMENT),
    entryCount: jest.fn().mockResolvedValue(0),
    entryFindUnique: jest.fn(),
    walletTransactionFindUnique: jest.fn(),
  };

  const tx = {
    tournamentEntry: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: shared.entryFindUnique,
      findMany: jest.fn().mockResolvedValue([]),
      count: shared.entryCount,
    },
    tournament: {
      updateMany: jest.fn(),
      update: jest.fn(),
      findUniqueOrThrow: shared.tournamentRead,
    },
    tournamentTable: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    tournamentSeat: { create: jest.fn(), updateMany: jest.fn() },
    wallet: { findUniqueOrThrow: jest.fn() },
    walletTransaction: { findUnique: shared.walletTransactionFindUnique },
    // Lock pessimista do torneio (`SELECT ... FOR UPDATE`).
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'trn-1' }]),
  };

  return {
    tx,
    tournament: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: shared.tournamentRead,
      updateMany: jest.fn(),
    },
    tournamentPrize: { findMany: jest.fn() },
    tournamentEntry: {
      findMany: jest.fn(),
      findUnique: shared.entryFindUnique,
      count: shared.entryCount,
      update: jest.fn(),
    },
    blindStructure: { findUnique: jest.fn() },
    walletTransaction: { findUnique: shared.walletTransactionFindUnique },
    wallet: { findUniqueOrThrow: jest.fn() },
    // `registerEntry`/`eliminateEntry`/`redrawTables`/`finishTournament` abrem
    // a transação via `PrismaService.withClube` (CL-BE-06), não mais
    // `$transaction` puro — o mock aceita e ignora `clubeId`, igual o
    // `withClube` real ignoraria discordância nenhuma aqui (é o mesmo `tx`
    // preparado acima).
    withClube: jest.fn((_clubeId: string, cb: (t: typeof tx) => unknown) =>
      cb(tx),
    ),
  };
}

/** Cenário feliz de inscrição: tudo mockado até o `update` final da entry. */
function primeRegister(
  prisma: ReturnType<typeof buildPrisma>,
  walletService: { applyLedgerEntry: jest.Mock },
  tournament: Record<string, unknown> = TOURNAMENT,
) {
  prisma.walletTransaction.findUnique.mockResolvedValue(null);
  prisma.wallet.findUniqueOrThrow.mockResolvedValue(WALLET);
  prisma.tournament.findUnique.mockResolvedValue(tournament);
  prisma.tournamentEntry.count.mockResolvedValue(0);
  prisma.tx.tournamentEntry.create.mockResolvedValue({ id: 'entry-1' });
  walletService.applyLedgerEntry.mockResolvedValue({ id: 'wtxn-1' });
  prisma.tx.tournamentTable.create.mockResolvedValue({ id: 'table-1' });
  prisma.tx.tournamentEntry.update.mockResolvedValue(ENTRY_ROW);
}

function buildService(overrides?: { prisma?: ReturnType<typeof buildPrisma> }) {
  const prisma = overrides?.prisma ?? buildPrisma();
  const walletService = { applyLedgerEntry: jest.fn() };

  const service = new TournamentService(
    prisma as unknown as PrismaService,
    walletService as unknown as WalletService,
  );

  return { service, prisma, walletService };
}

describe('TournamentService', () => {
  describe('createTournament', () => {
    const validDto = (
      prizes: Array<{ position: number; percentage: string }>,
    ) => ({
      name: 'Sunday Major',
      buyIn: '90.00',
      fee: '10.00',
      startingStack: 10_000,
      maxPlayers: 100,
      startsAt: '2026-02-01T21:00:00.000Z',
      prizes,
    });

    it('rejeita grade cuja soma de percentuais não fecha 100', async () => {
      const { service } = buildService();
      await expect(
        service.createTournament(
          'admin-1',
          CLUBE_ID,
          validDto([{ position: 1, percentage: '90.00' }]) as never,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejeita colocações repetidas na grade', async () => {
      const { service } = buildService();
      const dto = validDto([
        { position: 1, percentage: '50.00' },
        { position: 1, percentage: '50.00' },
      ]);
      await expect(
        service.createTournament('admin-1', CLUBE_ID, dto as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('cria o torneio em REGISTERING quando a grade fecha 100', async () => {
      const { service, prisma } = buildService();
      prisma.tournament.create.mockResolvedValue(TOURNAMENT);

      const dto = validDto([
        { position: 1, percentage: '70.00' },
        { position: 2, percentage: '30.00' },
      ]);
      const result = await service.createTournament('admin-1', CLUBE_ID, dto);

      expect(prisma.tournament.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'REGISTERING' }),
        }),
      );
      expect(result.status).toBe('REGISTERING');
    });

    // MT-BE-03.
    it('copia os níveis do preset para o torneio (cópia por valor)', async () => {
      const { service, prisma } = buildService();
      prisma.blindStructure.findUnique.mockResolvedValue({
        id: 'bs-1',
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
      });
      prisma.tournament.create.mockResolvedValue(TOURNAMENT);

      await service.createTournament('admin-1', CLUBE_ID, {
        ...validDto([{ position: 1, percentage: '100.00' }]),
        blindStructureId: 'bs-1',
        tableCapacity: 8,
      });

      expect(prisma.tournament.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tableCapacity: 8,
            blindStructureId: 'bs-1',
            blindLevels: {
              create: [
                expect.objectContaining({ levelNumber: 1, bigBlind: 50 }),
              ],
            },
          }),
        }),
      );
    });

    it('lança 404 quando o preset de blinds não existe', async () => {
      const { service, prisma } = buildService();
      prisma.blindStructure.findUnique.mockResolvedValue(null);

      await expect(
        service.createTournament('admin-1', CLUBE_ID, {
          ...validDto([{ position: 1, percentage: '100.00' }]),
          blindStructureId: 'inexistente',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('usa capacidade 9 por padrão', async () => {
      const { service, prisma } = buildService();
      prisma.tournament.create.mockResolvedValue(TOURNAMENT);

      await service.createTournament(
        'admin-1',
        CLUBE_ID,
        validDto([{ position: 1, percentage: '100.00' }]),
      );

      expect(prisma.tournament.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tableCapacity: 9 }),
        }),
      );
    });

    it('rejeita maxReentries sem allowReentry', async () => {
      const { service } = buildService();
      await expect(
        service.createTournament('admin-1', CLUBE_ID, {
          ...validDto([{ position: 1, percentage: '100.00' }]),
          maxReentries: 2,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejeita reentryUntilLevel fora da estrutura de blinds', async () => {
      const { service, prisma } = buildService();
      prisma.blindStructure.findUnique.mockResolvedValue({
        id: 'bs-1',
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
      });

      await expect(
        service.createTournament('admin-1', CLUBE_ID, {
          ...validDto([{ position: 1, percentage: '100.00' }]),
          blindStructureId: 'bs-1',
          allowReentry: true,
          reentryUntilLevel: 5,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejeita staffBonusCost sem staffBonusChips', async () => {
      const { service } = buildService();
      await expect(
        service.createTournament('admin-1', CLUBE_ID, {
          ...validDto([{ position: 1, percentage: '100.00' }]),
          staffBonusCost: '5.00',
        }),
      ).rejects.toThrow(/staffBonusCost e staffBonusChips/);
    });

    it('rejeita staffBonusChips sem staffBonusCost', async () => {
      const { service } = buildService();
      await expect(
        service.createTournament('admin-1', CLUBE_ID, {
          ...validDto([{ position: 1, percentage: '100.00' }]),
          staffBonusChips: 2_500,
        }),
      ).rejects.toThrow(/staffBonusCost e staffBonusChips/);
    });

    it('aceita staffBonusCost + staffBonusChips juntos', async () => {
      const { service, prisma } = buildService();
      prisma.tournament.create.mockResolvedValue(TOURNAMENT);

      await service.createTournament('admin-1', CLUBE_ID, {
        ...validDto([{ position: 1, percentage: '100.00' }]),
        staffBonusCost: '5.00',
        staffBonusChips: 2_500,
      });

      expect(prisma.tournament.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            staffBonusCost: '5.00',
            staffBonusChips: 2_500,
          }),
        }),
      );
    });
  });

  describe('getTournament', () => {
    it('lança 404 quando o torneio não existe', async () => {
      const { service, prisma } = buildService();
      prisma.tournament.findUnique.mockResolvedValue(null);
      await expect(
        service.getTournament(CLUBE_ID, 'inexistente'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('registerEntry', () => {
    it('rejeita quando o torneio não está REGISTERING', async () => {
      const { service, prisma } = buildService();
      prisma.walletTransaction.findUnique.mockResolvedValue(null);
      prisma.wallet.findUniqueOrThrow.mockResolvedValue(WALLET);
      prisma.tournament.findUnique.mockResolvedValue({
        ...TOURNAMENT,
        status: 'RUNNING',
      });

      await expect(
        service.registerEntry('user-1', CLUBE_ID, 'trn-1', 'idem-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejeita quando o torneio está lotado', async () => {
      const { service, prisma } = buildService();
      prisma.walletTransaction.findUnique.mockResolvedValue(null);
      prisma.wallet.findUniqueOrThrow.mockResolvedValue(WALLET);
      prisma.tournament.findUnique.mockResolvedValue(TOURNAMENT);
      prisma.tournamentEntry.count
        .mockResolvedValueOnce(0) // inscrições anteriores DESTE jogador
        .mockResolvedValueOnce(TOURNAMENT.maxPlayers); // vivos no torneio

      await expect(
        service.registerEntry('user-1', CLUBE_ID, 'trn-1', 'idem-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    // MT-BE-04, armadilha 1: o replay tem que devolver o MESMO ticket.
    it('replay idempotente devolve mesa/assento sem debitar de novo', async () => {
      const { service, prisma, walletService } = buildService();
      prisma.walletTransaction.findUnique.mockResolvedValue({
        tournamentEntryId: 'entry-1',
      });
      prisma.tournamentEntry.findUnique.mockResolvedValue({
        ...ENTRY_ROW,
        seats: [{ seatNumber: 4, tournamentTable: { tableNumber: 2 } }],
      });

      const result = await service.registerEntry(
        'user-1',
        CLUBE_ID,
        'trn-1',
        'idem-1',
      );

      expect(result).toMatchObject({
        id: 'entry-1',
        tableNumber: 2,
        seatNumber: 4,
      });
      expect(prisma.tournamentEntry.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            seats: expect.objectContaining({ where: { active: true } }),
          }),
        }),
      );
      expect(walletService.applyLedgerEntry).not.toHaveBeenCalled();
    });

    it('debita buyIn+fee, cria a inscrição e incrementa o prize pool', async () => {
      const { service, prisma, walletService } = buildService();
      primeRegister(prisma, walletService);

      await service.registerEntry('user-1', CLUBE_ID, 'trn-1', 'idem-1');

      expect(walletService.applyLedgerEntry).toHaveBeenCalledWith(
        prisma.tx,
        WALLET.id,
        expect.objectContaining({
          type: 'TOURNAMENT_BUY_IN',
          amount: expect.objectContaining({ s: -1 }) as unknown, // Decimal negativo (buyIn+fee)
        }),
      );
      expect(prisma.tx.tournament.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            prizePool: { increment: TOURNAMENT.buyIn },
          }),
        }),
      );
    });

    describe('bônus de staff (staff add-on)', () => {
      const WITH_STAFF_BONUS = {
        ...TOURNAMENT,
        staffBonusCost: new Prisma.Decimal('5.00'),
        staffBonusChips: 2_500,
      };

      it('staffBonus: true debita buyIn+fee+staffBonusCost e credita fichas extras', async () => {
        const { service, prisma, walletService } = buildService();
        primeRegister(prisma, walletService, WITH_STAFF_BONUS);

        await service.registerEntry(
          'user-1',
          CLUBE_ID,
          'trn-1',
          'idem-1',
          true,
        );

        const [, , ledgerInput] = walletService.applyLedgerEntry.mock
          .calls[0] as [unknown, unknown, { amount: Prisma.Decimal }];
        expect(ledgerInput.amount.toFixed(2)).toBe('-105.00'); // 90 + 10 + 5
        expect(prisma.tx.tournamentEntry.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              chipStack: TOURNAMENT.startingStack + 2_500,
              staffBonusPaid: true,
            }),
          }),
        );
        // O prize pool NUNCA vê o bônus de staff — só o buyIn, como sempre.
        expect(prisma.tx.tournament.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              prizePool: { increment: WITH_STAFF_BONUS.buyIn },
            }),
          }),
        );
      });

      it('sem staffBonus (padrão), debita só buyIn+fee e NÃO credita fichas extras', async () => {
        const { service, prisma, walletService } = buildService();
        primeRegister(prisma, walletService, WITH_STAFF_BONUS);

        await service.registerEntry('user-1', CLUBE_ID, 'trn-1', 'idem-1');

        const [, , ledgerInput] = walletService.applyLedgerEntry.mock
          .calls[0] as [unknown, unknown, { amount: Prisma.Decimal }];
        expect(ledgerInput.amount.toFixed(2)).toBe('-100.00'); // 90 + 10
        expect(prisma.tx.tournamentEntry.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              chipStack: TOURNAMENT.startingStack,
              staffBonusPaid: false,
            }),
          }),
        );
      });

      it('staffBonus: true num torneio SEM bônus configurado rejeita com 400', async () => {
        const { service, prisma, walletService } = buildService();
        primeRegister(prisma, walletService, TOURNAMENT); // staffBonusCost: null

        await expect(
          service.registerEntry('user-1', CLUBE_ID, 'trn-1', 'idem-1', true),
        ).rejects.toThrow(/não oferece bônus de staff/);
        expect(walletService.applyLedgerEntry).not.toHaveBeenCalled();
      });
    });

    // MT-BE-04: assento na MESMA transação (o `tx` do ledger), mesa 1 aberta
    // quando o torneio ainda não tem nenhuma.
    it('abre a primeira mesa e senta o jogador na mesma transação', async () => {
      const { service, prisma, walletService } = buildService();
      primeRegister(prisma, walletService);

      await service.registerEntry('user-1', CLUBE_ID, 'trn-1', 'idem-1');

      expect(prisma.tx.tournamentTable.create).toHaveBeenCalledWith({
        data: { tournamentId: 'trn-1', tableNumber: 1, capacity: 9 },
      });
      expect(prisma.tx.tournamentSeat.create).toHaveBeenCalledWith({
        data: {
          tournamentTableId: 'table-1',
          tournamentEntryId: 'entry-1',
          seatNumber: 1,
          reason: 'INITIAL',
        },
      });
      expect(prisma.withClube).toHaveBeenCalledTimes(1);
    });

    // MT-BE-04, lacuna de composição: mesa nova ao lado de mesa cheia nasce
    // equilibrada — `planInitialSeat` + `planRebalance` na mesma transação.
    it('rebalanceia quando a inscrição abre uma segunda mesa', async () => {
      const { service, prisma, walletService } = buildService();
      primeRegister(prisma, walletService, {
        ...TOURNAMENT,
        tableCapacity: 4,
        maxPlayers: 10,
      });
      prisma.tx.tournamentTable.create.mockResolvedValue({ id: 'table-2' });
      prisma.tx.tournamentTable.findMany
        // Antes: mesa 1 lotada (capacidade 4).
        .mockResolvedValueOnce([tableRow(1, 4, ['e1', 'e2', 'e3', 'e4'])])
        // Depois de abrir a mesa 2 e sentar o novo jogador nela: 4/1.
        .mockResolvedValueOnce([
          tableRow(1, 4, ['e1', 'e2', 'e3', 'e4']),
          tableRow(2, 4, ['entry-1']),
        ]);

      await service.registerEntry('user-1', CLUBE_ID, 'trn-1', 'idem-1');

      // 4/1 viola a invariante: um jogador da mesa cheia acompanha o novo.
      expect(prisma.tx.tournamentSeat.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tournamentEntryId: 'e4', active: true },
        }),
      );
      expect(prisma.tx.tournamentSeat.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tournamentEntryId: 'e4',
          tournamentTableId: 'table-2',
          seatNumber: 2,
          reason: 'BALANCE',
          fromTableId: 'table-1',
          fromSeatNumber: 4,
          movedById: null,
        }),
      });
    });

    // MT-QA-01: a inscrição entrou na MESMA seção crítica da eliminação. O
    // plano de assento é calculado depois do lock, com o mapa lido lá dentro —
    // é isso que substituiu o retry por colisão de assento.
    it('segura o lock pessimista do torneio antes de planejar o assento', async () => {
      const { service, prisma, walletService } = buildService();
      primeRegister(prisma, walletService);
      const order: string[] = [];
      prisma.tx.$queryRaw.mockImplementation(() => {
        order.push('lock');
        return Promise.resolve([{ id: 'trn-1' }]);
      });
      prisma.tx.tournamentTable.findMany.mockImplementation(() => {
        order.push('readTables');
        return Promise.resolve([]);
      });

      await service.registerEntry('user-1', CLUBE_ID, 'trn-1', 'idem-1');

      expect(order[0]).toBe('lock');
      expect(order).toContain('readTables');
    });

    // MT-QA-01: duplo-clique real — as duas cópias passam pelo caminho rápido
    // de idempotência antes de qualquer commit. Quem pega o lock depois TEM que
    // achar o ticket da gêmea, não abrir uma inscrição nova nem responder erro.
    it('replay concorrente é resolvido dentro da transação, sob o lock', async () => {
      const { service, prisma, walletService } = buildService();
      primeRegister(prisma, walletService);
      prisma.walletTransaction.findUnique
        .mockResolvedValueOnce(null) // caminho rápido: a gêmea ainda não commitou
        .mockResolvedValueOnce({ tournamentEntryId: 'entry-1' }); // sob o lock: commitou
      prisma.tournamentEntry.findUnique.mockResolvedValue({
        ...ENTRY_ROW,
        seats: [{ seatNumber: 4, tournamentTable: { tableNumber: 2 } }],
      });

      const result = await service.registerEntry(
        'user-1',
        CLUBE_ID,
        'trn-1',
        'idem-1',
      );

      expect(result).toMatchObject({ id: 'entry-1', tableNumber: 2 });
      expect(prisma.tx.tournamentEntry.create).not.toHaveBeenCalled();
      expect(walletService.applyLedgerEntry).not.toHaveBeenCalled();
      expect(prisma.tx.tournamentSeat.create).not.toHaveBeenCalled();
    });

    // MT-BE-04, armadilha 4 (outro lado): entry duplicada continua 409.
    it('mapeia violação de unique (já inscrito) para 409', async () => {
      const { service, prisma } = buildService();
      prisma.walletTransaction.findUnique.mockResolvedValue(null);
      prisma.wallet.findUniqueOrThrow.mockResolvedValue(WALLET);
      prisma.tournament.findUnique.mockResolvedValue(TOURNAMENT);
      (prisma.withClube as jest.Mock).mockRejectedValue(
        uniqueError('tournament_entries_active_user_unique'),
      );

      await expect(
        service.registerEntry('user-1', CLUBE_ID, 'trn-1', 'idem-1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  // MT-BE-09.
  describe('registerEntry (reentrada)', () => {
    const eliminatedBefore = (
      prisma: ReturnType<typeof buildPrisma>,
      tournament: Record<string, unknown>,
    ) => {
      prisma.walletTransaction.findUnique.mockResolvedValue(null);
      prisma.wallet.findUniqueOrThrow.mockResolvedValue(WALLET);
      prisma.tournament.findUnique.mockResolvedValue(tournament);
      prisma.tournamentEntry.count.mockResolvedValueOnce(1); // 1 entry anterior
    };

    it('recusa reentrada em torneio freezeout', async () => {
      const { service, prisma } = buildService();
      eliminatedBefore(prisma, { ...TOURNAMENT, status: 'RUNNING' });

      await expect(
        service.registerEntry('user-1', CLUBE_ID, 'trn-1', 'idem-2'),
      ).rejects.toThrow('Este torneio não permite reentrada.');
    });

    it('recusa quando o limite de reentradas foi atingido', async () => {
      const { service, prisma } = buildService();
      eliminatedBefore(prisma, {
        ...TOURNAMENT,
        status: 'RUNNING',
        allowReentry: true,
        maxReentries: 1,
      });
      prisma.tournamentEntry.count.mockReset();
      prisma.tournamentEntry.count.mockResolvedValueOnce(2); // já entrou 2x

      await expect(
        service.registerEntry('user-1', CLUBE_ID, 'trn-1', 'idem-2'),
      ).rejects.toThrow(/Limite de 1 reentrada/);
    });

    it('recusa depois do nível-limite de reentrada', async () => {
      const { service, prisma } = buildService();
      eliminatedBefore(prisma, {
        ...TOURNAMENT,
        status: 'RUNNING',
        allowReentry: true,
        reentryUntilLevel: 6,
        currentLevelNumber: 7,
      });

      await expect(
        service.registerEntry('user-1', CLUBE_ID, 'trn-1', 'idem-2'),
      ).rejects.toThrow(/Reentradas encerradas/);
    });

    it('recusa por nível-limite mesmo quando a coluna gravada está DESATUALIZADA (relógio andou sozinho)', async () => {
      // O relógio anda por tempo de parede sem precisar de `next()` manual
      // (`advanceClockToNow`, `tournament.mappers.ts`) — `currentLevelNumber`
      // gravado no banco pode estar atrasado se ninguém tocou no relógio
      // recentemente. Esta é a checagem de segurança que evita uma reentrada
      // escapar do corte só porque a coluna crua ainda não foi atualizada.
      const anchor = new Date('2026-02-01T21:00:00.000Z');
      jest.useFakeTimers();
      try {
        jest.setSystemTime(anchor);

        const { service, prisma } = buildService();
        eliminatedBefore(prisma, {
          ...TOURNAMENT,
          status: 'RUNNING',
          allowReentry: true,
          reentryUntilLevel: 2,
          // GRAVADO como nível 1 (dentro do limite) — mas o tempo de parede
          // já avançou fisicamente para o nível 3.
          currentLevelNumber: 1,
          clockStatus: 'RUNNING',
          levelEndsAt: new Date(anchor.getTime() + 10 * 60_000), // nível 1 termina em 10 min
          blindLevels: [1, 2, 3].map((levelNumber) => ({
            levelNumber,
            smallBlind: 25 * levelNumber,
            bigBlind: 50 * levelNumber,
            ante: 0,
            durationSeconds: 600, // 10 min cada
            isBreak: false,
            breakLabel: null,
          })),
        });

        // 25 min de tempo real: nível 1 (10) + nível 2 (10) + 5 min dentro do
        // nível 3 — bem além do corte de reentrada (nível 2).
        jest.setSystemTime(new Date(anchor.getTime() + 25 * 60_000));

        await expect(
          service.registerEntry('user-1', CLUBE_ID, 'trn-1', 'idem-2'),
        ).rejects.toThrow(/Reentradas encerradas/);
      } finally {
        jest.useRealTimers();
      }
    });

    it('aceita reentrada em torneio já RUNNING, com novo assento e prize pool', async () => {
      const { service, prisma, walletService } = buildService();
      primeRegister(prisma, walletService, {
        ...TOURNAMENT,
        status: 'RUNNING',
        allowReentry: true,
        maxReentries: 2,
        reentryUntilLevel: 6,
        currentLevelNumber: 6,
      });
      prisma.tournamentEntry.count.mockReset();
      prisma.tournamentEntry.count
        .mockResolvedValueOnce(1) // uma entry anterior (eliminada)
        .mockResolvedValueOnce(1); // vivos
      prisma.tx.tournamentTable.findMany.mockResolvedValue([
        tableRow(1, 9, ['e1']),
      ]);

      await service.registerEntry('user-1', CLUBE_ID, 'trn-1', 'idem-2');

      // Entry NOVA (a antiga nunca é tocada) + assento novo na mesa existente.
      expect(prisma.tx.tournamentEntry.create).toHaveBeenCalled();
      expect(prisma.tx.tournamentSeat.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tournamentTableId: 'table-1',
          seatNumber: 2,
          reason: 'INITIAL',
        }),
      });
      expect(prisma.tx.tournament.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            prizePool: { increment: TOURNAMENT.buyIn },
          }),
        }),
      );
    });
  });

  describe('eliminateEntry', () => {
    const playing = { id: 'entry-1', tournamentId: 'trn-1', status: 'PLAYING' };

    it('lança 404 quando a inscrição não existe', async () => {
      const { service, prisma } = buildService();
      prisma.tx.tournamentEntry.findUnique.mockResolvedValue(null);
      await expect(
        service.eliminateEntry(CLUBE_ID, 'trn-1', 'entry-1', {}),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lança 404 quando o torneio não existe (lock não encontra a linha)', async () => {
      const { service, prisma } = buildService();
      prisma.tx.$queryRaw.mockResolvedValue([]);
      await expect(
        service.eliminateEntry(CLUBE_ID, 'trn-1', 'entry-1', {}),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.tx.tournamentEntry.findUnique).not.toHaveBeenCalled();
    });

    it('rejeita eliminar quem já foi eliminado', async () => {
      const { service, prisma } = buildService();
      prisma.tx.tournamentEntry.findUnique.mockResolvedValue({
        ...playing,
        status: 'ELIMINATED',
      });
      await expect(
        service.eliminateEntry(CLUBE_ID, 'trn-1', 'entry-1', {}),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.tx.tournamentSeat.updateMany).not.toHaveBeenCalled();
    });

    it('libera o assento, zera o stack e leva o torneio a RUNNING na mesma transação', async () => {
      const { service, prisma } = buildService();
      prisma.tx.tournamentEntry.findUnique.mockResolvedValue(playing);
      prisma.tx.tournamentEntry.update.mockResolvedValue({
        ...ENTRY_ROW,
        status: 'ELIMINATED',
        chipStack: 0,
        finalPosition: 4,
      });

      const result = await service.eliminateEntry(
        CLUBE_ID,
        'trn-1',
        'entry-1',
        {
          finalPosition: 4,
        },
      );

      expect(prisma.tx.$queryRaw).toHaveBeenCalled(); // lock pessimista
      expect(prisma.tx.tournamentSeat.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tournamentEntryId: 'entry-1', active: true },
          data: expect.objectContaining({ active: false }),
        }),
      );
      expect(prisma.tx.tournament.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'RUNNING' } }),
      );
      // Fechamento de mesas vazias, sempre por último.
      expect(prisma.tx.tournamentTable.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'CLOSED' } }),
      );
      expect(result.chipStack).toBe(0);
      expect(result.finalPosition).toBe(4);
      // Sem assento ativo depois da eliminação.
      expect(result.tableNumber).toBeNull();
    });

    it('quebra a mesa e move os jogadores com reason BREAK', async () => {
      const { service, prisma } = buildService();
      prisma.tx.tournamentEntry.findUnique.mockResolvedValue(playing);
      prisma.tx.tournamentEntry.update.mockResolvedValue({
        ...ENTRY_ROW,
        status: 'ELIMINATED',
        chipStack: 0,
      });
      // Pós-eliminação: 2 mesas de 9, uma com 1 jogador -> cabe na outra.
      prisma.tx.tournamentTable.findMany.mockResolvedValue([
        tableRow(1, 9, ['a', 'b', 'c']),
        tableRow(2, 9, ['d']),
      ]);

      await service.eliminateEntry(CLUBE_ID, 'trn-1', 'entry-1', {});

      expect(prisma.tx.tournamentSeat.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tournamentEntryId: 'd',
          tournamentTableId: 'table-1',
          reason: 'BREAK',
          fromTableId: 'table-2',
          movedById: null,
        }),
      });
    });

    it('aborta tudo se a liberação do assento falhar (rollback)', async () => {
      const { service, prisma } = buildService();
      prisma.tx.tournamentEntry.findUnique.mockResolvedValue(playing);
      prisma.tx.tournamentSeat.updateMany.mockRejectedValue(
        new Error('deadlock'),
      );

      await expect(
        service.eliminateEntry(CLUBE_ID, 'trn-1', 'entry-1', {}),
      ).rejects.toThrow('deadlock');
      expect(prisma.tx.tournamentEntry.update).not.toHaveBeenCalled();
    });
  });

  // MT-BE-06.
  describe('redrawTables', () => {
    it('rejeita redraw sem jogadores vivos', async () => {
      const { service, prisma } = buildService();
      prisma.tx.tournamentEntry.findMany.mockResolvedValue([]);
      await expect(
        service.redrawTables('admin-1', CLUBE_ID, 'trn-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('solta todos os assentos, abre a mesa que faltava e sorteia com MANUAL_REDRAW', async () => {
      const { service, prisma } = buildService();
      prisma.tx.tournament.findUniqueOrThrow.mockResolvedValue({
        tableCapacity: 2,
      });
      prisma.tx.tournamentEntry.findMany.mockResolvedValue([
        { id: 'a' },
        { id: 'b' },
        { id: 'c' },
      ]);
      prisma.tx.tournamentTable.findMany
        .mockResolvedValueOnce([tableRow(1, 2, ['a', 'b'])])
        .mockResolvedValueOnce([
          tableRow(1, 2, ['a', 'b']),
          tableRow(2, 2, ['c']),
        ]);
      prisma.tx.tournamentTable.create.mockResolvedValue({ id: 'table-2' });

      const map = await service.redrawTables('admin-1', CLUBE_ID, 'trn-1');

      // Uma mesa nova (3 jogadores / capacidade 2 = 2 mesas).
      expect(prisma.tx.tournamentTable.create).toHaveBeenCalledWith({
        data: { tournamentId: 'trn-1', tableNumber: 2, capacity: 2 },
      });
      // Todo mundo solto ANTES de qualquer inserção.
      expect(prisma.tx.tournamentSeat.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { active: true, tournamentTable: { tournamentId: 'trn-1' } },
        }),
      );
      expect(prisma.tx.tournamentSeat.create).toHaveBeenCalledTimes(3);
      for (const call of prisma.tx.tournamentSeat.create.mock.calls) {
        expect(call[0].data).toMatchObject({
          reason: 'MANUAL_REDRAW',
          movedById: 'admin-1', // ator obrigatório no redraw manual
        });
      }
      expect(map.playersRemaining).toBe(3);
      expect(map.tables).toHaveLength(2);
    });
  });

  describe('finishTournament', () => {
    it('rejeita torneio já finalizado', async () => {
      const { service, prisma } = buildService();
      prisma.tournament.findUnique.mockResolvedValue({
        ...TOURNAMENT,
        status: 'FINISHED',
      });
      await expect(
        service.finishTournament(CLUBE_ID, 'trn-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejeita quando restam múltiplas inscrições ativas e há prêmio de 1º lugar', async () => {
      const { service, prisma } = buildService();
      prisma.tournament.findUnique.mockResolvedValue(TOURNAMENT);
      prisma.tournamentPrize.findMany.mockResolvedValue([
        { position: 1, percentage: new Prisma.Decimal('100.00') },
      ]);
      prisma.tournamentEntry.findMany.mockResolvedValue([
        {
          id: 'e1',
          userId: 'u1',
          status: 'PLAYING',
          finalPosition: null,
          payoutTransactionId: null,
        },
        {
          id: 'e2',
          userId: 'u2',
          status: 'PLAYING',
          finalPosition: null,
          payoutTransactionId: null,
        },
      ]);

      await expect(
        service.finishTournament(CLUBE_ID, 'trn-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('paga o campeão inferido automaticamente (só 1 sobrou) e finaliza o torneio', async () => {
      const { service, prisma, walletService } = buildService();
      prisma.tournament.findUnique.mockResolvedValueOnce(TOURNAMENT); // status check
      prisma.tournamentPrize.findMany.mockResolvedValue([
        { position: 1, percentage: new Prisma.Decimal('70.00') },
        { position: 2, percentage: new Prisma.Decimal('30.00') },
      ]);
      prisma.tournamentEntry.findMany
        // 1ª chamada real: computar remaining/payouts.
        .mockResolvedValueOnce([
          {
            id: 'e1',
            userId: 'u1',
            status: 'PLAYING',
            finalPosition: null,
            payoutTransactionId: null,
          },
          {
            id: 'e2',
            userId: 'u2',
            status: 'ELIMINATED',
            finalPosition: 2,
            payoutTransactionId: null,
          },
        ])
        // 2ª chamada real: dentro de getTournament() ao final.
        .mockResolvedValueOnce([]);
      prisma.wallet.findUniqueOrThrow.mockImplementation(() =>
        Promise.resolve(WALLET),
      );
      prisma.tx.wallet.findUniqueOrThrow.mockResolvedValue(WALLET);
      walletService.applyLedgerEntry.mockResolvedValue({ id: 'wtxn-payout' });
      // getTournament() ao final:
      prisma.tournament.findUnique.mockResolvedValueOnce({
        ...TOURNAMENT,
        status: 'FINISHED',
        _count: { entries: 2 },
      });

      await service.finishTournament(CLUBE_ID, 'trn-1');

      // 2 payouts: campeão (e1, inferido) e vice (e2, finalPosition já setado).
      expect(walletService.applyLedgerEntry).toHaveBeenCalledTimes(2);
      expect(prisma.tx.tournamentEntry.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'e1' },
          data: expect.objectContaining({ status: 'PAID', finalPosition: 1 }),
        }),
      );
      expect(prisma.tx.tournament.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'FINISHED' }),
        }),
      );
    });
  });
});
