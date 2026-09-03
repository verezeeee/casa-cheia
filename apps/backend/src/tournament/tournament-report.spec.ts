import { Prisma } from '../generated/prisma';
import {
  buildTournamentReport,
  type TournamentReportEntrySource,
  type TournamentReportPrizeSource,
  type TournamentReportSource,
} from './tournament-report';

/**
 * RT-QA-01 — Unitário exaustivo de `tournament-report.ts`.
 *
 * Todo dinheiro dos fixtures é `Prisma.Decimal`, nunca `number`: é o mesmo tipo
 * que o Prisma Client devolve para colunas `NUMERIC`, e usar `number` aqui
 * mascararia justamente o erro de ponto flutuante que o arquivo sob teste
 * existe para evitar.
 */

/** Base temporal fixa — nenhum teste depende do relógio de parede. */
const T0 = Date.UTC(2026, 8, 1, 22, 0, 0);

/** Instante `minutes` após `T0`. */
function at(minutes: number): Date {
  return new Date(T0 + minutes * 60_000);
}

const NOW = at(300);

function money(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function tournament(
  overrides: Partial<TournamentReportSource> = {},
): TournamentReportSource {
  return {
    id: 't-1',
    name: 'Terça Deepstack',
    status: 'FINISHED',
    buyIn: money('100.00'),
    fee: money('20.00'),
    staffBonusCost: null,
    startsAt: at(0),
    startedAt: at(10),
    finishedAt: at(250),
    prizePool: money('900.00'),
    guaranteedPrize: null,
    currentLevelNumber: 14,
    ...overrides,
  };
}

/**
 * Inscrição. `userId`/`user.name` são derivados do `id` para que reentrada
 * (mesmo `userId` em dois ids) seja sempre explícita no fixture.
 */
function entry(
  overrides: Partial<TournamentReportEntrySource> & { id: string },
): TournamentReportEntrySource {
  return {
    userId: `u-${overrides.id}`,
    user: { name: `Jogador ${overrides.id}` },
    status: 'ELIMINATED',
    staffBonusPaid: false,
    finalPosition: null,
    prizeAmount: null,
    registeredAt: at(0),
    eliminatedAt: null,
    ...overrides,
  };
}

function prize(
  position: number,
  percentage: string,
): TournamentReportPrizeSource {
  return { position, percentage: money(percentage) };
}

/** `entryId -> position`, o formato em que as asserções de ranking são legíveis. */
function positionsOf(
  ranking: ReadonlyArray<{ entryId: string; position: number }>,
): Record<string, number> {
  return Object.fromEntries(ranking.map((row) => [row.entryId, row.position]));
}

describe('buildTournamentReport (RT-BE-02)', () => {
  describe('posições do ranking', () => {
    it('deriva as 6 colocações não gravadas na ordem inversa de eliminação, sem repetir nem faltar posição', () => {
      const entries = [
        // Faixa premiada: o staff gravou a colocação na eliminação.
        entry({
          id: 'e1',
          status: 'PAID',
          finalPosition: 1,
          prizeAmount: money('450.00'),
        }),
        entry({
          id: 'e2',
          status: 'PAID',
          finalPosition: 2,
          prizeAmount: money('270.00'),
          eliminatedAt: at(240),
        }),
        entry({
          id: 'e3',
          status: 'PAID',
          finalPosition: 3,
          prizeAmount: money('180.00'),
          eliminatedAt: at(230),
        }),
        // Fora da faixa premiada: ninguém digitou colocação, só sobrou a hora
        // da eliminação. Horários deliberadamente FORA da ordem de inscrição.
        entry({ id: 'e4', eliminatedAt: at(120) }),
        entry({ id: 'e5', eliminatedAt: at(220) }),
        entry({ id: 'e6', eliminatedAt: at(160) }),
        entry({ id: 'e7', eliminatedAt: at(200) }),
        entry({ id: 'e8', eliminatedAt: at(140) }),
        entry({ id: 'e9', eliminatedAt: at(180) }),
      ];

      const report = buildTournamentReport(
        tournament(),
        [prize(1, '50.00'), prize(2, '30.00'), prize(3, '20.00')],
        entries,
        2,
        NOW,
      );

      expect(positionsOf(report.ranking)).toEqual({
        e1: 1,
        e2: 2,
        e3: 3,
        e5: 4, // eliminado às 220 — o último a cair entre os não gravados
        e7: 5, // 200
        e9: 6, // 180
        e6: 7, // 160
        e8: 8, // 140
        e4: 9, // 120 — o primeiro a cair, último colocado
      });
      // Ranking sai em `position` ascendente e o conjunto é exatamente 1..N.
      expect(report.ranking.map((row) => row.position)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9,
      ]);
      expect(
        report.ranking
          .filter((row) => row.positionSource === 'RECORDED')
          .map((row) => row.entryId),
      ).toEqual(['e1', 'e2', 'e3']);
      expect(
        report.ranking.filter((row) => row.positionSource === 'DERIVED'),
      ).toHaveLength(6);
      // `finalPosition` continua exposto cru ao lado de `position`.
      expect(report.ranking[0].finalPosition).toBe(1);
      expect(report.ranking[3].finalPosition).toBeNull();
    });

    it('dá a melhor posição LIVRE ao campeão sem finalPosition e sem eliminatedAt', () => {
      const report = buildTournamentReport(
        tournament(),
        [],
        [
          entry({ id: 'champ', status: 'REGISTERED' }),
          entry({ id: 'e2', eliminatedAt: at(200) }),
          entry({ id: 'e3', eliminatedAt: at(100) }),
        ],
        1,
        NOW,
      );

      expect(positionsOf(report.ranking)).toEqual({ champ: 1, e2: 2, e3: 3 });
      expect(report.ranking[0].positionSource).toBe('DERIVED');
      expect(report.ranking[0].eliminatedAt).toBeNull();
      expect(report.ranking[1].eliminatedAt).toBe(at(200).toISOString());
    });

    it('empurra o campeão para a melhor posição AINDA LIVRE quando a 1ª está gravada em outra entry', () => {
      const report = buildTournamentReport(
        tournament(),
        [],
        [
          entry({ id: 'champ', status: 'REGISTERED' }),
          entry({ id: 'e2', finalPosition: 1, eliminatedAt: at(240) }),
          entry({ id: 'e3', eliminatedAt: at(100) }),
        ],
        1,
        NOW,
      );

      expect(positionsOf(report.ranking)).toEqual({ e2: 1, champ: 2, e3: 3 });
    });

    it('ordena por inscrição quando ninguém tem eliminatedAt (torneio CANCELLED com todos REGISTERED)', () => {
      const report = buildTournamentReport(
        tournament({
          status: 'CANCELLED',
          startedAt: null,
          currentLevelNumber: null,
        }),
        [],
        [
          entry({ id: 'b', status: 'REGISTERED', registeredAt: at(5) }),
          entry({ id: 'a', status: 'REGISTERED', registeredAt: at(1) }),
        ],
        0,
        NOW,
      );

      expect(positionsOf(report.ranking)).toEqual({ a: 1, b: 2 });
      expect(report.stats.lastLevelNumber).toBeNull();
    });

    it('desempata eliminações no MESMO instante por inscrição e, em seguida, por entryId', () => {
      const sameInstant = at(200);
      const report = buildTournamentReport(
        tournament(),
        [],
        [
          entry({ id: 'z', registeredAt: at(2), eliminatedAt: sameInstant }),
          entry({ id: 'y', registeredAt: at(1), eliminatedAt: sameInstant }),
          entry({ id: 'x', registeredAt: at(1), eliminatedAt: sameInstant }),
        ],
        1,
        NOW,
      );

      // `registeredAt` primeiro (x e y às 1min, z às 2min); entre x e y, o
      // `entryId` decide — resultado idêntico a cada geração do relatório.
      expect(positionsOf(report.ranking)).toEqual({ x: 1, y: 2, z: 3 });
    });
  });

  describe('dados sujos são preservados, nunca corrigidos e nunca lançam', () => {
    it('mantém finalPosition DUPLICADO nas duas entries como RECORDED', () => {
      const entries = [
        entry({ id: 'a-dup', finalPosition: 2, eliminatedAt: at(240) }),
        entry({ id: 'b-dup', finalPosition: 2, eliminatedAt: at(230) }),
        entry({ id: 'c-livre', eliminatedAt: at(100) }),
      ];

      const build = () =>
        buildTournamentReport(tournament(), [], entries, 1, NOW);
      expect(build).not.toThrow();

      const report = build();
      expect(report.ranking.map((row) => row.entryId)).toEqual([
        'c-livre',
        'a-dup',
        'b-dup',
      ]);
      expect(report.ranking.map((row) => row.position)).toEqual([1, 2, 2]);
      expect(report.ranking.map((row) => row.positionSource)).toEqual([
        'DERIVED',
        'RECORDED',
        'RECORDED',
      ]);
    });

    it('mantém finalPosition ACIMA de N como RECORDED e faz o cursor livre ultrapassar N', () => {
      const report = buildTournamentReport(
        tournament(),
        [],
        [
          entry({ id: 'fora', finalPosition: 17, eliminatedAt: at(240) }),
          entry({ id: 'livre', eliminatedAt: at(100) }),
        ],
        1,
        NOW,
      );

      expect(positionsOf(report.ranking)).toEqual({ livre: 1, fora: 17 });
      expect(report.ranking[1].positionSource).toBe('RECORDED');
    });

    it('mantém finalPosition ABAIXO de 1 (zero/negativo) como RECORDED, sem reservar posição livre', () => {
      const report = buildTournamentReport(
        tournament(),
        [],
        [
          entry({ id: 'zero', finalPosition: 0, eliminatedAt: at(240) }),
          entry({ id: 'neg', finalPosition: -3, eliminatedAt: at(230) }),
          entry({ id: 'livre', eliminatedAt: at(100) }),
        ],
        1,
        NOW,
      );

      expect(positionsOf(report.ranking)).toEqual({
        neg: -3,
        zero: 0,
        livre: 1,
      });
      expect(report.ranking.map((row) => row.positionSource)).toEqual([
        'RECORDED',
        'RECORDED',
        'DERIVED',
      ]);
    });
  });

  describe('reentrada', () => {
    it('conta 2 entradas, 1 jogador único e marca isReentry só na mais nova', () => {
      const report = buildTournamentReport(
        tournament(),
        [],
        [
          entry({
            id: 'primeira',
            userId: 'u-bruno',
            registeredAt: at(0),
            eliminatedAt: at(60),
          }),
          entry({
            id: 'reentrada',
            userId: 'u-bruno',
            registeredAt: at(65),
            eliminatedAt: at(200),
          }),
        ],
        1,
        NOW,
      );

      expect(report.stats.totalEntries).toBe(2);
      expect(report.stats.uniquePlayers).toBe(1);
      expect(report.stats.reentries).toBe(1);
      expect(report.ranking.map((row) => [row.entryId, row.isReentry])).toEqual(
        [
          ['reentrada', true], // sobreviveu mais tempo ⇒ melhor colocação
          ['primeira', false],
        ],
      );
      // Duas linhas para o MESMO jogador — o ranking conta inscrições.
      expect(new Set(report.ranking.map((row) => row.userId)).size).toBe(1);
      // Receita de taxa cobra as DUAS entradas.
      expect(report.stats.feeRevenue).toBe('40.00');
    });

    it('acha a entrada mais antiga mesmo quando a mais nova vem primeiro na lista', () => {
      const report = buildTournamentReport(
        tournament(),
        [],
        [
          entry({ id: 'nova', userId: 'u-ana', registeredAt: at(65) }),
          entry({ id: 'velha', userId: 'u-ana', registeredAt: at(0) }),
        ],
        1,
        NOW,
      );

      expect(report.stats.reentries).toBe(1);
      expect(
        report.ranking.filter((row) => row.isReentry).map((row) => row.entryId),
      ).toEqual(['nova']);
    });

    it('com registeredAt IDÊNTICO marca exatamente uma reentrada (desempate por entryId)', () => {
      const sameInstant = at(30);
      const report = buildTournamentReport(
        tournament(),
        [],
        [
          entry({ id: 'b', userId: 'u-caio', registeredAt: sameInstant }),
          entry({ id: 'a', userId: 'u-caio', registeredAt: sameInstant }),
        ],
        1,
        NOW,
      );

      expect(report.stats.uniquePlayers).toBe(1);
      expect(report.stats.reentries).toBe(1);
      // `reentries` é uma contagem; `isReentry` é uma marca. Os dois números
      // saem do mesmo lugar e não podem divergir.
      expect(report.ranking.filter((row) => row.isReentry)).toHaveLength(1);
      expect(
        report.ranking.filter((row) => row.isReentry).map((row) => row.entryId),
      ).toEqual(['b']);
    });
  });

  describe('inscrições REFUNDED', () => {
    it('ficam fora do ranking, contam em refundedEntries e não geram receita', () => {
      const report = buildTournamentReport(
        tournament(),
        [],
        [
          entry({ id: 'valida-1', eliminatedAt: at(200) }),
          entry({ id: 'valida-2', eliminatedAt: at(100) }),
          entry({
            id: 'cancelada',
            status: 'REFUNDED',
            staffBonusPaid: true,
            registeredAt: at(1),
          }),
        ],
        1,
        NOW,
      );

      expect(report.ranking.map((row) => row.entryId)).toEqual([
        'valida-1',
        'valida-2',
      ]);
      expect(report.stats.refundedEntries).toBe(1);
      expect(report.stats.totalEntries).toBe(2);
      expect(report.stats.feeRevenue).toBe('40.00'); // 20 × 2, não × 3
      // O cancelamento devolveu o bônus junto com o buy-in.
      expect(report.stats.staffBonusesPaid).toBe(0);
    });

    it('não conta como primeira entrada do jogador que se inscreveu de novo depois de cancelar', () => {
      const report = buildTournamentReport(
        tournament(),
        [],
        [
          entry({
            id: 'cancelada',
            userId: 'u-dora',
            status: 'REFUNDED',
            registeredAt: at(0),
          }),
          entry({ id: 'valida', userId: 'u-dora', registeredAt: at(30) }),
        ],
        1,
        NOW,
      );

      expect(report.stats.totalEntries).toBe(1);
      expect(report.stats.uniquePlayers).toBe(1);
      expect(report.stats.reentries).toBe(0);
      expect(report.ranking[0].isReentry).toBe(false);
    });
  });

  describe('financeiro', () => {
    it('fecha centavos de premiação que não somam redondo, sem erro de ponto flutuante', () => {
      // Grade 35/25/15/12.5/12.5 sobre um prize pool de 175.00. As duas últimas
      // faixas caem em 21.875, que `finishTournament` arredonda para 21.88 —
      // então a casa pagou 0.01 MAIS do que arrecadou, e o relatório mostra
      // isso como sobra negativa em vez de esconder.
      const entries = [
        entry({ id: 'p1', finalPosition: 1, prizeAmount: money('61.25') }),
        entry({
          id: 'p2',
          finalPosition: 2,
          prizeAmount: money('43.75'),
          eliminatedAt: at(240),
        }),
        entry({
          id: 'p3',
          finalPosition: 3,
          prizeAmount: money('26.25'),
          eliminatedAt: at(230),
        }),
        entry({
          id: 'p4',
          finalPosition: 4,
          prizeAmount: money('21.88'),
          eliminatedAt: at(220),
        }),
        entry({
          id: 'p5',
          finalPosition: 5,
          prizeAmount: money('21.88'),
          eliminatedAt: at(210),
        }),
        entry({ id: 'p6', eliminatedAt: at(200) }),
        entry({ id: 'p7', eliminatedAt: at(190) }),
      ];

      const report = buildTournamentReport(
        tournament({
          buyIn: money('25.00'),
          fee: money('5.00'),
          prizePool: money('175.00'),
        }),
        [
          prize(3, '15.00'),
          prize(1, '35.00'),
          prize(5, '12.50'),
          prize(2, '25.00'),
          prize(4, '12.50'),
        ],
        entries,
        1,
        NOW,
      );

      expect(report.stats.prizePool).toBe('175.00');
      expect(report.stats.totalPaidOut).toBe('175.01');
      expect(report.stats.unpaidPrizePool).toBe('-0.01');
      expect(report.stats.feeRevenue).toBe('35.00'); // 5.00 × 7
      expect(report.stats.houseRevenue).toBe('35.00');
      // Grade devolvida em `position` ascendente, independente da ordem de entrada.
      expect(report.prizes).toEqual([
        { position: 1, percentage: '35.00' },
        { position: 2, percentage: '25.00' },
        { position: 3, percentage: '15.00' },
        { position: 4, percentage: '12.50' },
        { position: 5, percentage: '12.50' },
      ]);
      expect(report.ranking[5].prizeAmount).toBeNull();
      expect(report.ranking[0].prizeAmount).toBe('61.25');
    });

    it('soma a receita do bônus de staff apenas das entradas que optaram', () => {
      const report = buildTournamentReport(
        tournament({ staffBonusCost: money('12.50') }),
        [],
        [
          entry({ id: 'e1', staffBonusPaid: true, eliminatedAt: at(200) }),
          entry({ id: 'e2', staffBonusPaid: true, eliminatedAt: at(150) }),
          entry({ id: 'e3', staffBonusPaid: false, eliminatedAt: at(100) }),
        ],
        1,
        NOW,
      );

      expect(report.staffBonusCost).toBe('12.50');
      expect(report.stats.staffBonusesPaid).toBe(2);
      expect(report.stats.staffBonusRevenue).toBe('25.00');
      expect(report.stats.feeRevenue).toBe('60.00');
      expect(report.stats.houseRevenue).toBe('85.00');
      expect(report.ranking.map((row) => row.staffBonusPaid)).toEqual([
        true,
        true,
        false,
      ]);
    });

    it('trata prêmio de 0.00 como prêmio pago, não como ausência de prêmio', () => {
      const report = buildTournamentReport(
        tournament(),
        [],
        [entry({ id: 'e1', finalPosition: 1, prizeAmount: money('0.00') })],
        1,
        NOW,
      );

      expect(report.ranking[0].prizeAmount).toBe('0.00');
      expect(report.stats.totalPaidOut).toBe('0.00');
    });

    describe('overlay', () => {
      it('é positivo quando o garantido supera o arrecadado', () => {
        const report = buildTournamentReport(
          tournament({
            prizePool: money('900.00'),
            guaranteedPrize: money('5000.00'),
          }),
          [],
          [],
          0,
          NOW,
        );

        expect(report.stats.guaranteedPrize).toBe('5000.00');
        expect(report.stats.overlay).toBe('4100.00');
      });

      it('é zero (e não negativo) quando o arrecadado supera o garantido', () => {
        const report = buildTournamentReport(
          tournament({
            prizePool: money('900.00'),
            guaranteedPrize: money('500.00'),
          }),
          [],
          [],
          0,
          NOW,
        );

        expect(report.stats.overlay).toBe('0.00');
      });

      it('é nulo em torneio sem garantia', () => {
        const report = buildTournamentReport(
          tournament({ guaranteedPrize: null }),
          [],
          [],
          0,
          NOW,
        );

        expect(report.stats.guaranteedPrize).toBeNull();
        expect(report.stats.overlay).toBeNull();
      });
    });
  });

  describe('duração', () => {
    it('mede do início REAL quando startedAt existe', () => {
      const report = buildTournamentReport(
        tournament({ startedAt: at(10), finishedAt: at(250) }),
        [],
        [],
        0,
        NOW,
      );

      expect(report.stats.durationEstimated).toBe(false);
      expect(report.stats.durationMs).toBe(240 * 60_000);
      expect(report.stats.startedAt).toBe(at(10).toISOString());
      expect(report.stats.finishedAt).toBe(at(250).toISOString());
      expect(report.startsAt).toBe(at(0).toISOString());
    });

    it('estima a partir do horário AGENDADO quando startedAt é nulo', () => {
      const report = buildTournamentReport(
        tournament({ startedAt: null, finishedAt: at(250) }),
        [],
        [],
        0,
        NOW,
      );

      expect(report.stats.durationEstimated).toBe(true);
      expect(report.stats.startedAt).toBeNull();
      // 250min desde `startsAt`, e não 240 desde o início real que não existe.
      expect(report.stats.durationMs).toBe(250 * 60_000);
    });

    it('devolve durationMs nulo quando o torneio nunca foi encerrado', () => {
      const report = buildTournamentReport(
        tournament({ finishedAt: null }),
        [],
        [],
        0,
        NOW,
      );

      expect(report.stats.durationMs).toBeNull();
      expect(report.stats.finishedAt).toBeNull();
      expect(report.stats.durationEstimated).toBe(false);
    });

    it('clampa em 0 a duração negativa de um torneio encerrado antes do horário agendado', () => {
      const report = buildTournamentReport(
        tournament({
          status: 'CANCELLED',
          startsAt: at(600),
          startedAt: null,
          finishedAt: at(120),
        }),
        [],
        [],
        0,
        NOW,
      );

      expect(report.stats.durationMs).toBe(0);
      expect(report.stats.durationEstimated).toBe(true);
    });
  });

  describe('torneio vazio', () => {
    it('zera todos os agregados sem divisão por zero e devolve ranking vazio', () => {
      const report = buildTournamentReport(
        tournament({
          prizePool: money('0.00'),
          staffBonusCost: money('10.00'),
          currentLevelNumber: null,
          startedAt: null,
          finishedAt: at(30),
        }),
        [],
        [],
        0,
        NOW,
      );

      expect(report.ranking).toEqual([]);
      expect(report.prizes).toEqual([]);
      expect(report.stats).toMatchObject({
        totalEntries: 0,
        uniquePlayers: 0,
        reentries: 0,
        refundedEntries: 0,
        staffBonusesPaid: 0,
        tablesUsed: 0,
        lastLevelNumber: null,
        prizePool: '0.00',
        totalPaidOut: '0.00',
        unpaidPrizePool: '0.00',
        feeRevenue: '0.00',
        staffBonusRevenue: '0.00',
        houseRevenue: '0.00',
      });
    });
  });

  describe('cabeçalho e metadados', () => {
    it('copia identificação, valores e instante de geração', () => {
      const report = buildTournamentReport(
        tournament({
          id: 't-42',
          name: 'Sunday Major',
          status: 'CANCELLED',
          buyIn: money('250.00'),
          fee: money('50.00'),
          staffBonusCost: null,
        }),
        [],
        [entry({ id: 'e1', eliminatedAt: at(90) })],
        7,
        NOW,
      );

      expect(report).toMatchObject({
        tournamentId: 't-42',
        name: 'Sunday Major',
        status: 'CANCELLED',
        buyIn: '250.00',
        fee: '50.00',
        staffBonusCost: null,
        generatedAt: NOW.toISOString(),
      });
      expect(report.stats.tablesUsed).toBe(7);
      expect(report.stats.lastLevelNumber).toBe(14);
      expect(report.ranking[0]).toMatchObject({
        entryId: 'e1',
        userId: 'u-e1',
        userName: 'Jogador e1',
        status: 'ELIMINATED',
        registeredAt: at(0).toISOString(),
        eliminatedAt: at(90).toISOString(),
      });
    });

    it('não muta os arrays recebidos ao ordenar', () => {
      const prizes = [prize(2, '30.00'), prize(1, '70.00')];
      const entries = [
        entry({ id: 'e1', eliminatedAt: at(100) }),
        entry({ id: 'e2', eliminatedAt: at(200) }),
      ];

      buildTournamentReport(tournament(), prizes, entries, 1, NOW);

      expect(prizes.map((row) => row.position)).toEqual([2, 1]);
      expect(entries.map((row) => row.id)).toEqual(['e1', 'e2']);
    });
  });
});
