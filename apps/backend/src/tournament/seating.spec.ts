import {
  MT001_POLICY,
  planInitialSeat,
  planRebalance,
  planRedraw,
  type Move,
  type SeatedEntry,
  type TableSnapshot,
} from './seating';

/**
 * Fixture de mesa. `occupied` são NÚMEROS de assento; o `entryId` é derivado
 * (`e<mesa>-<assento>`) para que toda asserção de identidade seja legível.
 */
function table(
  tableNumber: number,
  capacity: number,
  occupied: number[],
  isOpen = true,
): TableSnapshot {
  return {
    tableNumber,
    capacity,
    isOpen,
    seats: occupied.map((seatNumber) => ({
      entryId: `e${tableNumber}-${seatNumber}`,
      seatNumber,
    })),
  };
}

function seq(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index + 1);
}

function occupancyAfter(
  tables: TableSnapshot[],
  moves: Move[],
): Map<number, number> {
  const occupancy = new Map(
    tables
      .filter((t) => t.isOpen)
      .map((t) => [t.tableNumber, t.seats.length] as const),
  );
  for (const move of moves) {
    occupancy.set(move.fromTable, (occupancy.get(move.fromTable) ?? 0) - 1);
    occupancy.set(move.toTable, (occupancy.get(move.toTable) ?? 0) + 1);
  }
  return occupancy;
}

describe('seating (MT-BE-02)', () => {
  describe('planInitialSeat', () => {
    it('abre a mesa 1 quando o torneio ainda não tem mesa alguma', () => {
      expect(planInitialSeat([], 9)).toEqual({
        tableNumber: 1,
        seatNumber: 1,
        openNewTable: true,
        capacity: 9,
      });
    });

    it('senta na mesa mais vazia com vaga', () => {
      const tables = [
        table(1, 9, seq(7)),
        table(2, 9, seq(3)),
        table(3, 9, seq(5)),
      ];
      expect(planInitialSeat(tables, 9)).toEqual({
        tableNumber: 2,
        seatNumber: 4,
        openNewTable: false,
        capacity: 9,
      });
    });

    it('desempata mesas igualmente vazias pelo MAIOR tableNumber', () => {
      const tables = [table(1, 9, seq(4)), table(2, 9, seq(4))];
      expect(planInitialSeat(tables, 9).tableNumber).toBe(2);
    });

    it('usa o primeiro assento livre por número, não o próximo do fim', () => {
      const tables = [table(1, 9, [1, 2, 4, 5])];
      expect(planInitialSeat(tables, 9).seatNumber).toBe(3);
    });

    it('abre mesa nova quando todas as abertas estão lotadas', () => {
      const tables = [table(1, 9, seq(9)), table(2, 9, seq(9))];
      // A capacidade devolvida é a `defaultCapacity` — é ela que o chamador
      // grava no `TournamentTable.create`.
      expect(planInitialSeat(tables, 6)).toEqual({
        tableNumber: 3,
        seatNumber: 1,
        openNewTable: true,
        capacity: 6,
      });
    });

    it('nunca senta em mesa CLOSED, mas respeita o número dela ao abrir a próxima', () => {
      // Mesa 2 fechada (quebrada): parece "a mais vazia", e reciclar o número
      // 2 colidiria com @@unique([tournamentId, tableNumber]) em todo retry.
      const tables = [table(1, 2, seq(2)), table(2, 9, [], false)];
      expect(planInitialSeat(tables, 9)).toEqual({
        tableNumber: 3,
        seatNumber: 1,
        openNewTable: true,
        capacity: 9,
      });
    });
  });

  describe('MT-001 item 1 — origem: sempre a mesa mais cheia, empate → maior tableNumber', () => {
    it('tira o jogador da mesa de maior número entre as mais cheias', () => {
      // 9 vivos e só 8 cadeiras nas outras duas ⇒ nenhuma quebra, só equilíbrio.
      const tables = [
        table(1, 4, seq(4)),
        table(2, 4, seq(4)),
        table(3, 4, [1]),
      ];
      const moves = planRebalance(tables);
      expect(moves[0].fromTable).toBe(2);
      expect(moves).toHaveLength(2);
      expect([...occupancyAfter(tables, moves).values()]).toEqual([3, 3, 3]);
    });

    it('tira o jogador do maior assento ocupado da mesa de origem (decisão (b))', () => {
      // Mesa 1 tem buraco no assento 3: sai quem está no 5, não quem está no 1.
      const tables = [table(1, 5, [1, 2, 4, 5]), table(2, 5, [1, 2])];
      const moves = planRebalance(tables);
      expect(moves).toEqual([
        {
          entryId: 'e1-5',
          fromTable: 1,
          fromSeat: 5,
          toTable: 2,
          toSeat: 3,
          reason: 'BALANCE',
        },
      ]);
    });
  });

  describe('MT-001 item 2 — destino: primeiro assento livre por número', () => {
    it('preenche o buraco de numeração da mesa de destino', () => {
      const tables = [
        table(1, 5, seq(5)),
        table(2, 5, [1, 3]),
        table(3, 5, seq(5)),
      ];
      const moves = planRebalance(tables);
      expect(moves[0]).toMatchObject({ toTable: 2, toSeat: 2 });
      expect(moves[1]).toMatchObject({ toTable: 2, toSeat: 4 });
    });
  });

  describe('MT-001 item 3 — sem limite de trocas por jogador', () => {
    it('move de novo, mais tarde, quem já tinha sido movido', () => {
      const first = planRebalance([
        table(1, 9, seq(9)),
        table(2, 9, seq(4)),
        table(3, 9, [1]),
      ]);
      expect(first[0]).toMatchObject({
        entryId: 'e3-1',
        reason: 'BREAK',
        toTable: 2,
        toSeat: 5,
      });

      // Depois de algumas eliminações, a mesa 2 (onde ele foi parar) é a vez
      // de quebrar: a política não tem memória de quem já foi movido.
      const second = planRebalance([
        table(1, 9, seq(6)),
        {
          tableNumber: 2,
          capacity: 9,
          isOpen: true,
          seats: [
            { entryId: 'e2-1', seatNumber: 1 },
            { entryId: 'e3-1', seatNumber: 5 },
          ],
        },
        table(3, 9, [], false),
      ]);
      expect(second.map((m) => m.entryId)).toContain('e3-1');
    });
  });

  describe('MT-001 item 4 — quebra de mesa', () => {
    it('quebra quando vivos <= (mesasAbertas - 1) * capacidade', () => {
      // 17 vivos, 3 mesas de 9 ⇒ 17 <= 18 ⇒ quebra.
      const tables = [
        table(1, 9, seq(9)),
        table(2, 9, seq(4)),
        table(3, 9, seq(4)),
      ];
      const moves = planRebalance(tables);
      expect(moves).toHaveLength(4);
      expect(moves.every((m) => m.reason === 'BREAK')).toBe(true);
      // Empate de "menos ocupada" (4 e 4) resolvido pelo MAIOR tableNumber.
      expect(moves.every((m) => m.fromTable === 3)).toBe(true);
      expect(occupancyAfter(tables, moves).get(3)).toBe(0);
      expect(moves.map((m) => m.fromSeat)).toEqual([4, 3, 2, 1]);
      expect(moves.map((m) => m.toSeat)).toEqual([5, 6, 7, 8]);
    });

    it('NÃO quebra quando os vivos não cabem nas mesas remanescentes', () => {
      // 19 vivos, 3 mesas de 9 ⇒ 19 > 18 ⇒ só equilíbrio.
      const tables = [
        table(1, 9, seq(9)),
        table(2, 9, seq(5)),
        table(3, 9, seq(5)),
      ];
      const moves = planRebalance(tables);
      expect(moves.every((m) => m.reason === 'BALANCE')).toBe(true);
      expect([...occupancyAfter(tables, moves).values()]).toEqual([7, 6, 6]);
    });

    it('quebra mesa já vazia sem gerar Move (o chamador é quem fecha — decisão (e))', () => {
      const tables = [table(1, 9, seq(5)), table(2, 9, [])];
      expect(planRebalance(tables)).toEqual([]);
    });

    it('quebra a mesa de capacidade menor quando ela é a menos ocupada (capacidades heterogêneas)', () => {
      // Final table de 8 convivendo com mesa de 9: a forma geral do gatilho é
      // "vivos <= capacidade das remanescentes".
      const tables = [table(1, 9, seq(6)), table(2, 8, seq(3))];
      const moves = planRebalance(tables);
      expect(moves).toHaveLength(3);
      expect(moves.every((m) => m.reason === 'BREAK')).toBe(true);
      expect(occupancyAfter(tables, moves).get(1)).toBe(9);
    });
  });

  describe('MT-001 item 5 — só produz Move quando a diferença passa de 1', () => {
    it('é no-op com diferença de exatamente 1', () => {
      expect(planRebalance([table(1, 5, seq(5)), table(2, 5, seq(4))])).toEqual(
        [],
      );
    });

    it('é no-op com mesas idênticas', () => {
      expect(planRebalance([table(1, 5, seq(3)), table(2, 5, seq(3))])).toEqual(
        [],
      );
    });

    it('respeita um maxOccupancyGap mais frouxo vindo da política', () => {
      const tables = [table(1, 5, seq(5)), table(2, 5, seq(2))];
      expect(planRebalance(tables, { maxOccupancyGap: 3 })).toEqual([]);
      expect(planRebalance(tables, MT001_POLICY)).toHaveLength(1);
    });

    it('trata maxOccupancyGap < 1 como 1 em vez de oscilar para sempre', () => {
      const tables = [table(1, 5, seq(5)), table(2, 5, seq(4))];
      expect(planRebalance(tables, { maxOccupancyGap: 0 })).toEqual([]);
    });
  });

  describe('bordas de planRebalance', () => {
    it('não faz nada sem mesa aberta', () => {
      expect(planRebalance([])).toEqual([]);
      expect(planRebalance([table(1, 9, seq(3), false)])).toEqual([]);
    });

    it('não faz nada com uma única mesa aberta (quebrar deixaria o torneio sem mesa)', () => {
      expect(
        planRebalance([table(1, 9, seq(1)), table(2, 9, [], false)]),
      ).toEqual([]);
    });

    it('para sem mover quando nenhuma outra mesa tem vaga (decisão (c))', () => {
      const tables = [table(1, 2, seq(2)), table(2, 2, seq(2))];
      expect(planRebalance(tables)).toEqual([]);
    });

    it('move o que dá e para quando a última vaga acaba (decisão (c))', () => {
      // Mesa 2 é uma final table de 2 lugares: cabe 1, e o desequilíbrio
      // remanescente é irremediável sem abrir mesa — e rebalanceamento não abre.
      const tables = [table(1, 9, seq(9)), table(2, 2, [1])];
      const moves = planRebalance(tables);
      expect(moves).toHaveLength(1);
      expect(moves[0]).toMatchObject({ toTable: 2, toSeat: 2 });
    });
  });

  describe('planRedraw', () => {
    it('distribui todo mundo com diferença de ocupação <= 1', () => {
      const entries = Array.from({ length: 23 }, (_, i) => `entry-${i}`);
      const seats = planRedraw(entries, 9, 42);
      expect(seats).toHaveLength(23);
      expect(new Set(seats.map((s) => s.entryId)).size).toBe(23);
      const perTable = new Map<number, number>();
      for (const seat of seats) {
        perTable.set(
          seat.tableNumber,
          (perTable.get(seat.tableNumber) ?? 0) + 1,
        );
      }
      expect([...perTable.values()].sort()).toEqual([7, 8, 8]);
      expect(Math.max(...seats.map((s) => s.seatNumber))).toBeLessThanOrEqual(
        9,
      );
    });

    it('nunca repete um (mesa, assento)', () => {
      const entries = Array.from({ length: 40 }, (_, i) => `entry-${i}`);
      const seats = planRedraw(entries, 6, 7);
      const keys = seats.map((s) => `${s.tableNumber}:${s.seatNumber}`);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('é determinístico por seed e muda de resultado com outro seed', () => {
      const entries = Array.from({ length: 30 }, (_, i) => `entry-${i}`);
      expect(planRedraw(entries, 9, 1)).toEqual(planRedraw(entries, 9, 1));
      expect(planRedraw(entries, 9, 1)).not.toEqual(planRedraw(entries, 9, 2));
    });

    it('sem seed usa crypto.randomInt e ainda assim devolve um mapa válido', () => {
      const entries = Array.from({ length: 19 }, (_, i) => `entry-${i}`);
      const seats = planRedraw(entries, 9);
      expect(new Set(seats.map((s) => s.entryId)).size).toBe(19);
      expect(
        new Set(seats.map((s) => `${s.tableNumber}:${s.seatNumber}`)).size,
      ).toBe(19);
    });

    it('devolve lista vazia sem jogadores', () => {
      expect(planRedraw([], 9, 1)).toEqual([]);
    });

    it('rejeita capacidade inválida em vez de dividir por zero', () => {
      expect(() => planRedraw(['a'], 0)).toThrow(RangeError);
    });
  });

  /**
   * TESTE DE PROPRIEDADE (critério de aceite de MT-BE-02).
   *
   * 500 sequências pseudoaleatórias de inscrição/eliminação sobre um mundo que
   * imita o que `MT-BE-04`/`MT-BE-05` fazem no banco: `planInitialSeat` para
   * quem entra, liberação do assento de quem sai, `planRebalance` a cada passo
   * e fechamento de toda mesa que ficou sem assento ativo (decisão (e)).
   *
   * A invariante `max - min <= 1` é da COMPOSIÇÃO, não de `planInitialSeat`
   * sozinho. Com capacidade uniforme ela é sempre alcançável: se `max > min`
   * então `min < capacidade`, ou seja, a mesa mais vazia tem vaga — por isso a
   * asserção aqui é incondicional.
   */
  describe('teste de propriedade — 500 sequências aleatórias', () => {
    interface WorldTable {
      tableNumber: number;
      capacity: number;
      isOpen: boolean;
      seats: SeatedEntry[];
    }

    function prng(seed: number): () => number {
      let state = seed >>> 0;
      return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
      };
    }

    function mustFind(world: WorldTable[], tableNumber: number): WorldTable {
      const found = world.find((t) => t.tableNumber === tableNumber);
      if (found === undefined) {
        throw new Error(`plano aponta para a mesa inexistente ${tableNumber}`);
      }
      return found;
    }

    it('mantém max-min <= 1, um assento por jogador e zero destino duplicado', () => {
      for (let sequence = 1; sequence <= 500; sequence += 1) {
        const random = prng(sequence);
        const capacity = 2 + (sequence % 8);
        const world: WorldTable[] = [];
        const alive: string[] = [];
        let nextEntry = 0;
        const trace = `sequência ${sequence} (capacidade ${capacity})`;

        for (let step = 0; step < 60; step += 1) {
          const registering = alive.length === 0 || random() < 0.6;

          if (registering) {
            const entryId = `e${nextEntry++}`;
            const plan = planInitialSeat(world, capacity);
            if (plan.openNewTable) {
              // Nunca recicla número de mesa, nem de mesa fechada.
              expect(
                world.some((t) => t.tableNumber === plan.tableNumber),
              ).toBe(false);
              world.push({
                tableNumber: plan.tableNumber,
                capacity,
                isOpen: true,
                seats: [],
              });
            }
            const target = mustFind(world, plan.tableNumber);
            expect(target.isOpen).toBe(true);
            expect(
              target.seats.some((s) => s.seatNumber === plan.seatNumber),
            ).toBe(false);
            expect(plan.seatNumber).toBeLessThanOrEqual(capacity);
            target.seats.push({ entryId, seatNumber: plan.seatNumber });
            alive.push(entryId);
          } else {
            const victim = alive.splice(
              Math.floor(random() * alive.length),
              1,
            )[0];
            for (const t of world) {
              t.seats = t.seats.filter((s) => s.entryId !== victim);
            }
          }

          const moves = planRebalance(world);

          // Nenhum destino repetido dentro do mesmo plano.
          const destinations = moves.map((m) => `${m.toTable}:${m.toSeat}`);
          expect(new Set(destinations).size).toBe(destinations.length);
          // Nenhuma entry movida duas vezes no mesmo plano (decisão (d)).
          expect(new Set(moves.map((m) => m.entryId)).size).toBe(moves.length);

          for (const move of moves) {
            const from = mustFind(world, move.fromTable);
            const to = mustFind(world, move.toTable);
            expect(
              from.seats.some(
                (s) =>
                  s.entryId === move.entryId && s.seatNumber === move.fromSeat,
              ),
            ).toBe(true);
            expect(to.seats.some((s) => s.seatNumber === move.toSeat)).toBe(
              false,
            );
            expect(move.toSeat).toBeLessThanOrEqual(to.capacity);
            from.seats = from.seats.filter((s) => s.entryId !== move.entryId);
            to.seats.push({ entryId: move.entryId, seatNumber: move.toSeat });
          }

          // O que MT-BE-05 faz depois de aplicar o plano.
          for (const t of world) {
            if (t.isOpen && t.seats.length === 0) {
              t.isOpen = false;
            }
          }

          const open = world.filter((t) => t.isOpen);
          const seated = open.flatMap((t) => t.seats.map((s) => s.entryId));
          expect(new Set(seated).size).toBe(seated.length);
          expect([...seated].sort()).toEqual([...alive].sort());
          expect(
            world.filter((t) => !t.isOpen).every((t) => t.seats.length === 0),
          ).toBe(true);

          if (open.length > 0) {
            const occupancies = open.map((t) => t.seats.length);
            const spread = Math.max(...occupancies) - Math.min(...occupancies);
            if (spread > 1) {
              // `throw` em vez de `expect` para o relatório trazer a semente
              // que reproduz a falha — o valor inteiro de um property test.
              throw new Error(
                `${trace}, passo ${step}: spread ${spread} (${occupancies.join('/')})`,
              );
            }
          }
        }
      }
    });
  });
});
