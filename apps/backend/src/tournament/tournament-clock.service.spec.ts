import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { TournamentClockService } from './tournament-clock.service';

const NOW = new Date('2026-02-01T21:00:00.000Z');
const MINUTE = 60_000;
const CLUBE_ID = 'clube-1';

const LEVELS = [
  {
    id: 'lvl-1',
    tournamentId: 'trn-1',
    levelNumber: 1,
    smallBlind: 25,
    bigBlind: 50,
    ante: 0,
    durationSeconds: 1200, // 20 min
    isBreak: false,
    breakLabel: null,
  },
  {
    id: 'lvl-2',
    tournamentId: 'trn-1',
    levelNumber: 2,
    smallBlind: 50,
    bigBlind: 100,
    ante: 0,
    durationSeconds: 900, // 15 min
    isBreak: false,
    breakLabel: null,
  },
  {
    id: 'lvl-3',
    tournamentId: 'trn-1',
    levelNumber: 3,
    smallBlind: 75,
    bigBlind: 150,
    ante: 25,
    durationSeconds: 600, // 10 min
    isBreak: false,
    breakLabel: null,
  },
];

type ClockRow = {
  clockStatus: 'NOT_STARTED' | 'RUNNING' | 'PAUSED' | 'FINISHED';
  currentLevelNumber: number | null;
  levelEndsAt: Date | null;
  clockRemainingMs: number | null;
};

function tournamentRow(clock: Partial<ClockRow>, levels = LEVELS) {
  return {
    id: 'trn-1',
    version: 7,
    clockStatus: 'NOT_STARTED',
    currentLevelNumber: null,
    levelEndsAt: null,
    clockRemainingMs: null,
    ...clock,
    blindLevels: levels,
  };
}

function buildService(row: ReturnType<typeof tournamentRow> | null) {
  const tx = {
    tournament: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    tournamentBlindLevel: { update: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    tx,
    tournament: { findUnique: jest.fn().mockResolvedValue(row) },
    withClube: jest.fn((_clubeId: string, cb: (t: typeof tx) => unknown) =>
      cb(tx),
    ),
  };
  const service = new TournamentClockService(
    prisma as unknown as PrismaService,
  );
  return { service, prisma, tx };
}

/** Dados gravados no `updateMany` do torneio (o estado novo do relógio). */
function writtenClock(tx: ReturnType<typeof buildService>['tx']) {
  const call = tx.tournament.updateMany.mock.calls[0][0] as {
    where: { id: string; version: number };
    data: ClockRow & { version: { increment: number } };
  };
  return call;
}

describe('TournamentClockService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('lança 404 quando o torneio não existe', async () => {
    const { service } = buildService(null);
    await expect(service.start(CLUBE_ID, 'trn-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  describe('read (GET público de TV, MT-BE-08)', () => {
    it('deriva remainingMs de levelEndsAt sem escrever nada', async () => {
      const { service, tx } = buildService(
        tournamentRow({
          clockStatus: 'RUNNING',
          currentLevelNumber: 2,
          levelEndsAt: new Date(NOW.getTime() + 5 * MINUTE),
        }),
      );

      const dto = await service.read('trn-1');

      expect(dto).toMatchObject({
        clockStatus: 'RUNNING',
        remainingMs: 5 * MINUTE,
        serverTime: NOW.toISOString(),
        levelEndsAt: new Date(NOW.getTime() + 5 * MINUTE).toISOString(),
      });
      expect(dto.currentLevel?.levelNumber).toBe(2);
      expect(dto.nextLevel?.levelNumber).toBe(3);
      expect(tx.tournament.updateMany).not.toHaveBeenCalled();
    });

    it('em PAUSED devolve o tempo congelado, não o decorrido', async () => {
      const { service } = buildService(
        tournamentRow({
          clockStatus: 'PAUSED',
          currentLevelNumber: 1,
          clockRemainingMs: 3 * MINUTE,
        }),
      );

      const first = await service.read('trn-1');
      jest.setSystemTime(new Date(NOW.getTime() + 90_000));
      const second = await service.read('trn-1');

      expect(first.remainingMs).toBe(3 * MINUTE);
      expect(second.remainingMs).toBe(3 * MINUTE);
      expect(second.serverTime).not.toBe(first.serverTime);
    });

    it('lança 404 quando o torneio não existe', async () => {
      const { service } = buildService(null);
      await expect(service.read('trn-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    describe('avança sozinho por tempo de parede (advanceClockToNow)', () => {
      it('sem NENHUMA mutação prévia, já mostra o nível fisicamente correto', async () => {
        // Nível 1 (20 min) começou; ninguém tocou no relógio depois disso.
        const { service, tx } = buildService(
          tournamentRow({
            clockStatus: 'RUNNING',
            currentLevelNumber: 1,
            levelEndsAt: new Date(NOW.getTime() + 20 * MINUTE),
          }),
        );

        // 20 (nível 1) + 10 (dentro do nível 2, 15 min) = passaram-se 30 min.
        jest.setSystemTime(new Date(NOW.getTime() + 30 * MINUTE));
        const dto = await service.read('trn-1');

        expect(dto.currentLevel?.levelNumber).toBe(2);
        expect(dto.remainingMs).toBe(5 * MINUTE); // 15 - 10
        // `read` continua PURO: nada foi persistido só de ler.
        expect(tx.tournament.updateMany).not.toHaveBeenCalled();
      });

      it('pula MAIS DE UM nível de uma vez sem acumular deriva', async () => {
        // 20 (nível 1) + 15 (nível 2) + 3 (dentro do nível 3, 10 min) = 38 min.
        const { service } = buildService(
          tournamentRow({
            clockStatus: 'RUNNING',
            currentLevelNumber: 1,
            levelEndsAt: new Date(NOW.getTime() + 20 * MINUTE),
          }),
        );

        jest.setSystemTime(new Date(NOW.getTime() + 38 * MINUTE));
        const dto = await service.read('trn-1');

        expect(dto.currentLevel?.levelNumber).toBe(3);
        expect(dto.remainingMs).toBe(7 * MINUTE); // 10 - 3
      });

      it('passar do ÚLTIMO nível encerra sozinho (FINISHED), só de ler', async () => {
        const { service } = buildService(
          tournamentRow({
            clockStatus: 'RUNNING',
            currentLevelNumber: 1,
            levelEndsAt: new Date(NOW.getTime() + 20 * MINUTE),
          }),
        );

        // 20 + 15 + 10 = 45 min é a grade inteira; passa disso.
        jest.setSystemTime(new Date(NOW.getTime() + 50 * MINUTE));
        const dto = await service.read('trn-1');

        expect(dto.clockStatus).toBe('FINISHED');
        expect(dto.currentLevel?.levelNumber).toBe(3); // trava no último, à vista da TV
        expect(dto.remainingMs).toBe(0);
        expect(dto.levelEndsAt).toBeNull();
      });

      it('PAUSED não anda com o tempo de parede — continua congelado até alguém retomar', async () => {
        const { service } = buildService(
          tournamentRow({
            clockStatus: 'PAUSED',
            currentLevelNumber: 1,
            clockRemainingMs: 3 * MINUTE,
          }),
        );

        jest.setSystemTime(new Date(NOW.getTime() + 3 * 60 * MINUTE));
        const dto = await service.read('trn-1');

        expect(dto.currentLevel?.levelNumber).toBe(1);
        expect(dto.remainingMs).toBe(3 * MINUTE);
      });
    });
  });

  describe('avança sozinho em qualquer mutação (não só em read)', () => {
    it('pause() chamado depois de o tempo passar 2 níveis pausa no nível fisicamente correto', async () => {
      const { service, tx } = buildService(
        tournamentRow({
          clockStatus: 'RUNNING',
          currentLevelNumber: 1,
          levelEndsAt: new Date(NOW.getTime() + 20 * MINUTE),
        }),
      );

      // 20 + 15 + 4 min dentro do nível 3 (10 min) = 39 min.
      jest.setSystemTime(new Date(NOW.getTime() + 39 * MINUTE));
      const dto = await service.pause(CLUBE_ID, 'trn-1');

      expect(dto.currentLevel?.levelNumber).toBe(3);
      expect(dto.remainingMs).toBe(6 * MINUTE); // 10 - 4
      expect(writtenClock(tx).data).toMatchObject({
        clockStatus: 'PAUSED',
        currentLevelNumber: 3,
        clockRemainingMs: 6 * MINUTE,
      });
    });

    it('next() chamado bem depois do fim persiste o avanço + o próprio passo manual', async () => {
      const { service, tx } = buildService(
        tournamentRow({
          clockStatus: 'RUNNING',
          currentLevelNumber: 1,
          levelEndsAt: new Date(NOW.getTime() + 20 * MINUTE),
        }),
      );

      // Nível 1 (20 min) já teria terminado há 5 min — ninguém clicou em nada
      // até agora. `next()` primeiro alcança o nível 2 (fisicamente atual) e
      // DAÍ avança manualmente para o nível 3.
      jest.setSystemTime(new Date(NOW.getTime() + 25 * MINUTE));
      const dto = await service.next(CLUBE_ID, 'trn-1');

      expect(dto.currentLevel?.levelNumber).toBe(3);
      expect(writtenClock(tx).data.currentLevelNumber).toBe(3);
    });
  });

  describe('start', () => {
    it('NOT_STARTED → RUNNING no nível 1, terminando em now + duração', async () => {
      const { service, tx } = buildService(tournamentRow({}));

      const dto = await service.start(CLUBE_ID, 'trn-1');

      const { where, data } = writtenClock(tx);
      expect(where).toEqual({ id: 'trn-1', version: 7 });
      expect(data.clockStatus).toBe('RUNNING');
      expect(data.currentLevelNumber).toBe(1);
      expect(data.levelEndsAt).toEqual(new Date(NOW.getTime() + 20 * MINUTE));
      expect(data.clockRemainingMs).toBeNull();
      expect(data.version).toEqual({ increment: 1 });

      expect(dto.clockStatus).toBe('RUNNING');
      expect(dto.currentLevel?.levelNumber).toBe(1);
      expect(dto.nextLevel?.levelNumber).toBe(2);
      expect(dto.remainingMs).toBe(20 * MINUTE);
      expect(dto.levelEndsAt).toBe(
        new Date(NOW.getTime() + 20 * MINUTE).toISOString(),
      );
      expect(dto.serverTime).toBe(NOW.toISOString());
    });

    it.each(['RUNNING', 'PAUSED', 'FINISHED'] as const)(
      'recusa start com o relógio em %s',
      async (clockStatus) => {
        const { service, tx } = buildService(
          tournamentRow({ clockStatus, currentLevelNumber: 1 }),
        );
        await expect(service.start(CLUBE_ID, 'trn-1')).rejects.toBeInstanceOf(
          BadRequestException,
        );
        expect(tx.tournament.updateMany).not.toHaveBeenCalled();
      },
    );

    it('recusa start em torneio sem grade de blinds', async () => {
      const { service } = buildService(tournamentRow({}, []));
      await expect(service.start(CLUBE_ID, 'trn-1')).rejects.toThrow(
        /sem estrutura de blinds/,
      );
    });

    // RT-BE-01 — hora REAL de início do torneio (contraste com `startsAt`, que
    // é o horário agendado).
    describe('carimbo de startedAt', () => {
      it('grava startedAt em updateMany PRÓPRIO, fora das colunas do relógio', async () => {
        const { service, tx } = buildService(tournamentRow({}));

        await service.start(CLUBE_ID, 'trn-1');

        const [clockCall, stampCall] = tx.tournament.updateMany.mock.calls.map(
          ([arg]) => arg as { where: unknown; data: Record<string, unknown> },
        );

        // Disciplina de colunas nomeadas (MT-BE-07): o `data` do relógio
        // descreve o ESTADO DO RELÓGIO e nada mais.
        expect(clockCall.data).not.toHaveProperty('startedAt');
        // O carimbo vai numa escrita própria, com o guard no `where`.
        expect(stampCall).toEqual({
          where: { id: 'trn-1', startedAt: null },
          data: { startedAt: NOW },
        });
      });

      const RUNNING_ROW: Partial<ClockRow> = {
        clockStatus: 'RUNNING',
        currentLevelNumber: 2,
        levelEndsAt: new Date(NOW.getTime() + 10 * MINUTE),
      };
      const PAUSED_ROW: Partial<ClockRow> = {
        clockStatus: 'PAUSED',
        currentLevelNumber: 2,
        clockRemainingMs: 10 * MINUTE,
      };

      it.each([
        ['pause', RUNNING_ROW],
        ['resume', PAUSED_ROW],
        ['next', RUNNING_ROW],
        ['previous', RUNNING_ROW],
      ] as const)(
        '%s NÃO carimba startedAt (só o start marca início)',
        async (operation, row) => {
          const { service, tx } = buildService(tournamentRow(row));

          await service[operation](CLUBE_ID, 'trn-1');

          expect(tx.tournament.updateMany).toHaveBeenCalledTimes(1);
          expect(
            (tx.tournament.updateMany.mock.calls[0][0] as { data: object })
              .data,
          ).not.toHaveProperty('startedAt');
        },
      );

      it('não sobrescreve um carimbo já existente — a decisão é do banco, via `where`', async () => {
        // Fake com a semântica de `where: { startedAt: null }`: só a PRIMEIRA
        // escrita afeta linha. É assim que o horário mais antigo (o do relógio
        // ou o da primeira eliminação, o que vier primeiro) prevalece sem
        // read-then-write e sem corrida.
        let stored: Date | null = null;
        const tx = {
          tournament: {
            updateMany: jest.fn(
              (call: {
                where: { startedAt?: null };
                data: { startedAt?: Date };
              }) => {
                if (call.data.startedAt === undefined) {
                  return Promise.resolve({ count: 1 });
                }
                if (call.where.startedAt === null && stored !== null) {
                  return Promise.resolve({ count: 0 });
                }
                stored = call.data.startedAt;
                return Promise.resolve({ count: 1 });
              },
            ),
          },
          tournamentBlindLevel: { update: jest.fn() },
        };
        const prisma = {
          tournament: {
            findUnique: jest.fn().mockResolvedValue(tournamentRow({})),
          },
          withClube: jest.fn(
            (_clubeId: string, cb: (t: typeof tx) => unknown) => cb(tx),
          ),
        };
        const service = new TournamentClockService(
          prisma as unknown as PrismaService,
        );

        await service.start(CLUBE_ID, 'trn-1');
        expect(stored).toEqual(NOW);

        // Meia hora depois, o relógio é iniciado de novo (o `findUnique`
        // mockado devolve sempre `NOT_STARTED`). O carimbo original — o
        // instante em que o torneio de fato começou — não se move.
        jest.advanceTimersByTime(30 * MINUTE);
        await service.start(CLUBE_ID, 'trn-1');
        expect(stored).toEqual(NOW);
      });
    });
  });

  describe('pause', () => {
    it('RUNNING → PAUSED congelando o restante e zerando levelEndsAt', async () => {
      const { service, tx } = buildService(
        tournamentRow({
          clockStatus: 'RUNNING',
          currentLevelNumber: 1,
          levelEndsAt: new Date(NOW.getTime() + 20 * MINUTE),
        }),
      );

      jest.advanceTimersByTime(5 * MINUTE);
      const dto = await service.pause(CLUBE_ID, 'trn-1');

      const { data } = writtenClock(tx);
      expect(data.clockStatus).toBe('PAUSED');
      expect(data.levelEndsAt).toBeNull();
      expect(data.clockRemainingMs).toBe(15 * MINUTE);
      expect(dto.remainingMs).toBe(15 * MINUTE);
      expect(dto.levelEndsAt).toBeNull();
    });

    it('clampa em 0 ao pausar um nível já estourado', async () => {
      const { service, tx } = buildService(
        tournamentRow({
          clockStatus: 'RUNNING',
          currentLevelNumber: 1,
          levelEndsAt: new Date(NOW.getTime() + 20 * MINUTE),
        }),
      );

      jest.advanceTimersByTime(35 * MINUTE);
      await service.pause(CLUBE_ID, 'trn-1');

      expect(writtenClock(tx).data.clockRemainingMs).toBe(0);
    });

    it('linha incoerente (RUNNING sem levelEndsAt) congela em 0 em vez de estourar', async () => {
      // O CHECK tournaments_clock_state_coherent impede esse estado; o
      // fallback existe para não propagar NaN se alguém escrever fora da app.
      const { service, tx } = buildService(
        tournamentRow({ clockStatus: 'RUNNING', currentLevelNumber: 1 }),
      );

      const dto = await service.pause(CLUBE_ID, 'trn-1');

      expect(writtenClock(tx).data.clockRemainingMs).toBe(0);
      expect(dto.remainingMs).toBe(0);
    });

    it.each(['NOT_STARTED', 'PAUSED', 'FINISHED'] as const)(
      'recusa pause com o relógio em %s',
      async (clockStatus) => {
        const { service } = buildService(
          tournamentRow({
            clockStatus,
            currentLevelNumber: 1,
            clockRemainingMs: clockStatus === 'PAUSED' ? 1000 : null,
          }),
        );
        await expect(service.pause(CLUBE_ID, 'trn-1')).rejects.toBeInstanceOf(
          BadRequestException,
        );
      },
    );
  });

  describe('resume', () => {
    it('PAUSED → RUNNING devolvendo exatamente o tempo congelado', async () => {
      const { service, tx } = buildService(
        tournamentRow({
          clockStatus: 'PAUSED',
          currentLevelNumber: 2,
          clockRemainingMs: 15 * MINUTE,
        }),
      );

      // Uma hora parado não consome nada do nível.
      jest.advanceTimersByTime(60 * MINUTE);
      const dto = await service.resume(CLUBE_ID, 'trn-1');

      const resumedAt = new Date(NOW.getTime() + 60 * MINUTE);
      const { data } = writtenClock(tx);
      expect(data.clockStatus).toBe('RUNNING');
      expect(data.levelEndsAt).toEqual(
        new Date(resumedAt.getTime() + 15 * MINUTE),
      );
      expect(data.clockRemainingMs).toBeNull();
      expect(dto.remainingMs).toBe(15 * MINUTE);
      expect(dto.serverTime).toBe(resumedAt.toISOString());
    });

    it.each(['NOT_STARTED', 'RUNNING', 'FINISHED'] as const)(
      'recusa resume com o relógio em %s',
      async (clockStatus) => {
        const { service } = buildService(
          tournamentRow({
            clockStatus,
            currentLevelNumber: 1,
            levelEndsAt: clockStatus === 'RUNNING' ? NOW : null,
          }),
        );
        await expect(service.resume(CLUBE_ID, 'trn-1')).rejects.toBeInstanceOf(
          BadRequestException,
        );
      },
    );
  });

  describe('next / previous', () => {
    it('next em RUNNING recalcula levelEndsAt pela duração do nível novo', async () => {
      const { service, tx } = buildService(
        tournamentRow({
          clockStatus: 'RUNNING',
          currentLevelNumber: 1,
          levelEndsAt: new Date(NOW.getTime() + 20 * MINUTE),
        }),
      );

      jest.advanceTimersByTime(3 * MINUTE);
      const dto = await service.next(CLUBE_ID, 'trn-1');

      const { data } = writtenClock(tx);
      expect(data.clockStatus).toBe('RUNNING');
      expect(data.currentLevelNumber).toBe(2);
      expect(data.levelEndsAt).toEqual(
        new Date(NOW.getTime() + 3 * MINUTE + 15 * MINUTE),
      );
      expect(data.clockRemainingMs).toBeNull();
      expect(dto.currentLevel?.levelNumber).toBe(2);
      expect(dto.nextLevel?.levelNumber).toBe(3);
    });

    it('next em PAUSED continua pausado, com a duração cheia do nível novo', async () => {
      const { service, tx } = buildService(
        tournamentRow({
          clockStatus: 'PAUSED',
          currentLevelNumber: 1,
          clockRemainingMs: 4 * MINUTE,
        }),
      );

      const dto = await service.next(CLUBE_ID, 'trn-1');

      const { data } = writtenClock(tx);
      expect(data.clockStatus).toBe('PAUSED');
      expect(data.currentLevelNumber).toBe(2);
      expect(data.levelEndsAt).toBeNull();
      expect(data.clockRemainingMs).toBe(15 * MINUTE);
      expect(dto.remainingMs).toBe(15 * MINUTE);
      expect(dto.levelEndsAt).toBeNull();
    });

    it('next no último nível encerra o relógio (FINISHED) mantendo o nível à vista', async () => {
      const { service, tx } = buildService(
        tournamentRow({
          clockStatus: 'RUNNING',
          currentLevelNumber: 3,
          levelEndsAt: new Date(NOW.getTime() + 10 * MINUTE),
        }),
      );

      const dto = await service.next(CLUBE_ID, 'trn-1');

      const { data } = writtenClock(tx);
      expect(data.clockStatus).toBe('FINISHED');
      expect(data.currentLevelNumber).toBe(3);
      expect(data.levelEndsAt).toBeNull();
      expect(data.clockRemainingMs).toBeNull();
      expect(dto.currentLevel?.levelNumber).toBe(3);
      expect(dto.nextLevel).toBeNull();
      expect(dto.remainingMs).toBe(0);
    });

    it('previous volta um nível com a duração cheia', async () => {
      const { service, tx } = buildService(
        tournamentRow({
          clockStatus: 'RUNNING',
          currentLevelNumber: 2,
          levelEndsAt: new Date(NOW.getTime() + 5 * MINUTE),
        }),
      );

      await service.previous(CLUBE_ID, 'trn-1');

      const { data } = writtenClock(tx);
      expect(data.currentLevelNumber).toBe(1);
      expect(data.levelEndsAt).toEqual(new Date(NOW.getTime() + 20 * MINUTE));
    });

    it('recusa previous no primeiro nível', async () => {
      const { service } = buildService(
        tournamentRow({
          clockStatus: 'RUNNING',
          currentLevelNumber: 1,
          levelEndsAt: NOW,
        }),
      );
      await expect(service.previous(CLUBE_ID, 'trn-1')).rejects.toThrow(
        /já está no primeiro nível/,
      );
    });

    it.each(['NOT_STARTED', 'FINISHED'] as const)(
      'recusa next/previous com o relógio em %s',
      async (clockStatus) => {
        const { service } = buildService(
          tournamentRow({ clockStatus, currentLevelNumber: 2 }),
        );
        await expect(service.next(CLUBE_ID, 'trn-1')).rejects.toBeInstanceOf(
          BadRequestException,
        );
        await expect(
          service.previous(CLUBE_ID, 'trn-1'),
        ).rejects.toBeInstanceOf(BadRequestException);
      },
    );

    it('recusa quando o nível corrente não existe na grade', async () => {
      const { service } = buildService(
        tournamentRow({
          clockStatus: 'RUNNING',
          currentLevelNumber: null,
          levelEndsAt: NOW,
        }),
      );
      await expect(service.next(CLUBE_ID, 'trn-1')).rejects.toThrow(
        /Nível corrente não existe/,
      );
    });
  });

  describe('updateLevel', () => {
    it('grava os valores novos do nível na mesma transação do lock', async () => {
      const { service, tx, prisma } = buildService(
        tournamentRow({ clockStatus: 'NOT_STARTED' }),
      );

      const dto = await service.updateLevel(CLUBE_ID, 'trn-1', 2, {
        bigBlind: 200,
        smallBlind: 100,
      });

      expect(prisma.withClube).toHaveBeenCalledTimes(1);
      expect(tx.tournamentBlindLevel.update).toHaveBeenCalledWith({
        where: { id: 'lvl-2' },
        data: {
          smallBlind: 100,
          bigBlind: 200,
          ante: 0,
          durationSeconds: 900, // não enviado: preserva o valor gravado
        },
      });
      // NOT_STARTED: nenhuma coluna de relógio muda.
      const { data } = writtenClock(tx);
      expect(data.clockStatus).toBe('NOT_STARTED');
      expect(data.levelEndsAt).toBeNull();
      expect(data.clockRemainingMs).toBeNull();
      expect(dto.clockStatus).toBe('NOT_STARTED');
      // O UPDATE toca EXATAMENTE as colunas de relógio: o planejador recebe a
      // linha inteira do torneio, e vazar `blindLevels`/`blindStructureId`
      // para o `data` faz o Prisma recusar a query em runtime (500).
      expect(Object.keys(data).sort()).toEqual([
        'clockRemainingMs',
        'clockStatus',
        'currentLevelNumber',
        'levelEndsAt',
        'version',
      ]);
    });

    it('nível CORRENTE em RUNNING: aplica o DELTA, sem ressuscitar o tempo decorrido', async () => {
      const endsAt = new Date(NOW.getTime() + 20 * MINUTE);
      const { service, tx } = buildService(
        tournamentRow({
          clockStatus: 'RUNNING',
          currentLevelNumber: 1,
          levelEndsAt: endsAt,
        }),
      );

      jest.advanceTimersByTime(18 * MINUTE); // faltam 2 min
      const dto = await service.updateLevel(CLUBE_ID, 'trn-1', 1, {
        durationSeconds: 1500, // 20 min → 25 min, delta +5 min
      });

      const { data } = writtenClock(tx);
      expect(data.levelEndsAt).toEqual(new Date(endsAt.getTime() + 5 * MINUTE));
      expect(data.clockRemainingMs).toBeNull();
      // 2 min que faltavam + 5 min de acréscimo = 7 min (e NÃO os 25 min cheios).
      expect(dto.remainingMs).toBe(7 * MINUTE);
    });

    it('delta negativo maior que o restante deixa o nível esgotado (remainingMs = 0)', async () => {
      const endsAt = new Date(NOW.getTime() + 20 * MINUTE);
      const { service, tx } = buildService(
        tournamentRow({
          clockStatus: 'RUNNING',
          currentLevelNumber: 1,
          levelEndsAt: endsAt,
        }),
      );

      jest.advanceTimersByTime(18 * MINUTE);
      const dto = await service.updateLevel(CLUBE_ID, 'trn-1', 1, {
        durationSeconds: 600, // 20 min → 10 min, delta -10 min
      });

      expect(writtenClock(tx).data.levelEndsAt).toEqual(
        new Date(endsAt.getTime() - 10 * MINUTE),
      );
      expect(dto.remainingMs).toBe(0);
    });

    it('nível CORRENTE em PAUSED: aplica o delta no restante congelado', async () => {
      const { service, tx } = buildService(
        tournamentRow({
          clockStatus: 'PAUSED',
          currentLevelNumber: 2,
          clockRemainingMs: 6 * MINUTE,
        }),
      );

      const dto = await service.updateLevel(CLUBE_ID, 'trn-1', 2, {
        durationSeconds: 1080, // 15 min → 18 min, delta +3 min
      });

      const { data } = writtenClock(tx);
      expect(data.clockRemainingMs).toBe(9 * MINUTE);
      expect(data.levelEndsAt).toBeNull();
      expect(dto.remainingMs).toBe(9 * MINUTE);
    });

    it('nível CORRENTE em PAUSED com delta negativo: clampa em 0', async () => {
      const { service, tx } = buildService(
        tournamentRow({
          clockStatus: 'PAUSED',
          currentLevelNumber: 2,
          clockRemainingMs: 2 * MINUTE,
        }),
      );

      await service.updateLevel(CLUBE_ID, 'trn-1', 2, { durationSeconds: 300 }); // -10 min

      expect(writtenClock(tx).data.clockRemainingMs).toBe(0);
    });

    it('nível NÃO corrente não mexe no relógio, mesmo em RUNNING', async () => {
      const endsAt = new Date(NOW.getTime() + 20 * MINUTE);
      const { service, tx } = buildService(
        tournamentRow({
          clockStatus: 'RUNNING',
          currentLevelNumber: 1,
          levelEndsAt: endsAt,
        }),
      );

      await service.updateLevel(CLUBE_ID, 'trn-1', 3, { durationSeconds: 60 });

      const { data } = writtenClock(tx);
      expect(data.currentLevelNumber).toBe(1);
      expect(data.levelEndsAt).toEqual(endsAt);
      expect(data.clockRemainingMs).toBeNull();
    });

    it('editar o nível corrente sem mudar a duração não mexe no relógio', async () => {
      const endsAt = new Date(NOW.getTime() + 20 * MINUTE);
      const { service, tx } = buildService(
        tournamentRow({
          clockStatus: 'RUNNING',
          currentLevelNumber: 1,
          levelEndsAt: endsAt,
        }),
      );

      await service.updateLevel(CLUBE_ID, 'trn-1', 1, { ante: 25 });

      expect(writtenClock(tx).data.levelEndsAt).toEqual(endsAt);
      expect(tx.tournamentBlindLevel.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ ante: 25, durationSeconds: 1200 }),
        }),
      );
    });

    it('relógio FINISHED não volta a andar ao editar o último nível', async () => {
      const { service, tx } = buildService(
        tournamentRow({ clockStatus: 'FINISHED', currentLevelNumber: 3 }),
      );

      await service.updateLevel(CLUBE_ID, 'trn-1', 3, {
        durationSeconds: 3600,
      });

      const { data } = writtenClock(tx);
      expect(data.clockStatus).toBe('FINISHED');
      expect(data.levelEndsAt).toBeNull();
      expect(data.clockRemainingMs).toBeNull();
    });

    it('lança 404 para nível fora da grade', async () => {
      const { service } = buildService(tournamentRow({}));
      await expect(
        service.updateLevel(CLUBE_ID, 'trn-1', 99, { ante: 10 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejeita bigBlind menor que o smallBlind já gravado', async () => {
      const { service, tx } = buildService(tournamentRow({}));
      await expect(
        service.updateLevel(CLUBE_ID, 'trn-1', 2, { bigBlind: 40 }), // smallBlind gravado = 50
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.tournamentBlindLevel.update).not.toHaveBeenCalled();
    });
  });

  describe('lock otimista', () => {
    it('refaz o plano e reexecuta quando a version mudou no meio', async () => {
      const { service, prisma, tx } = buildService(
        tournamentRow({
          clockStatus: 'RUNNING',
          currentLevelNumber: 1,
          levelEndsAt: new Date(NOW.getTime() + 20 * MINUTE),
        }),
      );
      tx.tournament.updateMany
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 1 });

      await service.pause(CLUBE_ID, 'trn-1');

      expect(prisma.tournament.findUnique).toHaveBeenCalledTimes(2);
      expect(tx.tournament.updateMany).toHaveBeenCalledTimes(2);
    });

    it('propaga erro de banco em vez de tratá-lo como conflito de version', async () => {
      const { service, prisma } = buildService(tournamentRow({}));
      const boom = new Error('conexão caiu');
      prisma.withClube.mockImplementation(() => Promise.reject(boom));

      await expect(service.start(CLUBE_ID, 'trn-1')).rejects.toBe(boom);
      expect(prisma.tournament.findUnique).toHaveBeenCalledTimes(1);
    });

    it('desiste com 409 após 3 tentativas', async () => {
      const { service, prisma, tx } = buildService(tournamentRow({}));
      tx.tournament.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.start(CLUBE_ID, 'trn-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.tournament.findUnique).toHaveBeenCalledTimes(3);
    });
  });

  it('start → pause → resume → next preserva o tempo restante ponta a ponta', async () => {
    // Sequência real do diretor de torneio, com o estado fluindo de um passo
    // para o outro como o banco faria.
    let row = tournamentRow({});
    const build = () => buildService(row);

    const started = build();
    await started.service.start(CLUBE_ID, 'trn-1');
    row = tournamentRow(writtenClock(started.tx).data);

    jest.advanceTimersByTime(12 * MINUTE); // faltam 8 min
    const paused = build();
    const pausedDto = await paused.service.pause(CLUBE_ID, 'trn-1');
    expect(pausedDto.remainingMs).toBe(8 * MINUTE);
    row = tournamentRow(writtenClock(paused.tx).data);

    jest.advanceTimersByTime(30 * MINUTE); // intervalo longo, relógio parado
    const resumed = build();
    const resumedDto = await resumed.service.resume(CLUBE_ID, 'trn-1');
    expect(resumedDto.remainingMs).toBe(8 * MINUTE);
    row = tournamentRow(writtenClock(resumed.tx).data);

    jest.advanceTimersByTime(8 * MINUTE); // nível 1 esgotado
    const advanced = build();
    const nextDto = await advanced.service.next(CLUBE_ID, 'trn-1');
    expect(nextDto.currentLevel?.levelNumber).toBe(2);
    expect(nextDto.remainingMs).toBe(15 * MINUTE);
  });
});
