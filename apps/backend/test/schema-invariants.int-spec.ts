import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

/**
 * Testes de integração das invariantes de banco introduzidas na migration
 * `init_schema_integration` (T-DB-06): `CHECK` constraints e índices únicos
 * parciais que o Prisma Schema Language não expressa nativamente (ver os
 * comentários de `wallets`, `tables` e `table_sessions` nos arquivos
 * `.prisma`). Um erro de sintaxe no SQL escrito à mão só apareceria em
 * produção sem este arquivo.
 *
 * Roda contra Postgres real (`DATABASE_URL_TEST`, ver test/setup-env.ts).
 * Usa `PrismaClient` diretamente (sem bootstrap do Nest): o que está sob
 * teste é o schema do banco, não a aplicação.
 */
describe('Invariantes de schema (Postgres real)', () => {
  const prisma = new PrismaClient();

  /** Cria um User válido (dependência de FK para os demais testes). */
  const createUser = () =>
    prisma.user.create({
      data: {
        email: `${randomUUID()}@schema-invariants.test`,
        passwordHash: 'hash-fake-nao-usado-neste-teste',
        name: 'Usuário de teste',
      },
    });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('CHECK (wallets.balance >= 0)', () => {
    it('rejeita saldo negativo mesmo escrito fora da camada de aplicação', async () => {
      const user = await createUser();
      const wallet = await prisma.wallet.create({ data: { userId: user.id } });

      await expect(
        prisma.$executeRaw`UPDATE wallets SET balance = -1 WHERE id = ${wallet.id}`,
      ).rejects.toThrow(/constraint|check/i);
    });
  });

  describe('CHECK (tables.min_buy_in <= max_buy_in / max_seats BETWEEN 2 AND 10)', () => {
    it('rejeita min_buy_in maior que max_buy_in', async () => {
      const admin = await createUser();

      await expect(
        prisma.table.create({
          data: {
            name: 'Mesa inválida',
            type: 'CASH_GAME',
            smallBlind: 1,
            bigBlind: 2,
            minBuyIn: 500,
            maxBuyIn: 100,
            maxSeats: 6,
            status: 'OPEN',
            createdById: admin.id,
          },
        }),
      ).rejects.toThrow(/constraint|check/i);
    });

    it('rejeita max_seats fora do intervalo [2, 10]', async () => {
      const admin = await createUser();

      await expect(
        prisma.table.create({
          data: {
            name: 'Mesa inválida',
            type: 'CASH_GAME',
            smallBlind: 1,
            bigBlind: 2,
            minBuyIn: 100,
            maxBuyIn: 500,
            maxSeats: 11,
            status: 'OPEN',
            createdById: admin.id,
          },
        }),
      ).rejects.toThrow(/constraint|check/i);
    });
  });

  describe('índices únicos parciais de table_sessions (WHERE status = ACTIVE)', () => {
    const createTable = (createdById: string) =>
      prisma.table.create({
        data: {
          name: 'Mesa de teste',
          type: 'CASH_GAME',
          smallBlind: 1,
          bigBlind: 2,
          minBuyIn: 100,
          maxBuyIn: 500,
          maxSeats: 6,
          status: 'OPEN',
          createdById,
        },
      });

    it('rejeita duas sessões ACTIVE no mesmo assento da mesma mesa', async () => {
      const admin = await createUser();
      const table = await createTable(admin.id);
      const playerA = await createUser();
      const playerB = await createUser();

      await prisma.tableSession.create({
        data: {
          tableId: table.id,
          userId: playerA.id,
          seatNumber: 1,
          status: 'ACTIVE',
          currentStack: 100,
        },
      });

      await expect(
        prisma.tableSession.create({
          data: {
            tableId: table.id,
            userId: playerB.id,
            seatNumber: 1,
            status: 'ACTIVE',
            currentStack: 100,
          },
        }),
      ).rejects.toThrow(/unique constraint/i);
    });

    it('permite reocupar o mesmo assento depois que a sessão anterior fez CASHED_OUT', async () => {
      const admin = await createUser();
      const table = await createTable(admin.id);
      const playerA = await createUser();
      const playerB = await createUser();

      const first = await prisma.tableSession.create({
        data: {
          tableId: table.id,
          userId: playerA.id,
          seatNumber: 2,
          status: 'ACTIVE',
          currentStack: 100,
        },
      });
      await prisma.tableSession.update({
        where: { id: first.id },
        data: { status: 'CASHED_OUT', leftAt: new Date() },
      });

      await expect(
        prisma.tableSession.create({
          data: {
            tableId: table.id,
            userId: playerB.id,
            seatNumber: 2,
            status: 'ACTIVE',
            currentStack: 100,
          },
        }),
      ).resolves.toMatchObject({ seatNumber: 2, status: 'ACTIVE' });
    });

    it('rejeita duas sessões ACTIVE do mesmo usuário na mesma mesa', async () => {
      const admin = await createUser();
      const table = await createTable(admin.id);
      const player = await createUser();

      await prisma.tableSession.create({
        data: {
          tableId: table.id,
          userId: player.id,
          seatNumber: 3,
          status: 'ACTIVE',
          currentStack: 100,
        },
      });

      await expect(
        prisma.tableSession.create({
          data: {
            tableId: table.id,
            userId: player.id,
            seatNumber: 4,
            status: 'ACTIVE',
            currentStack: 100,
          },
        }),
      ).rejects.toThrow(/unique constraint/i);
    });
  });

  describe('relações Prisma cross-context (T-DB-06)', () => {
    it('resolve User -> Wallet -> WalletTransaction via `include`', async () => {
      const user = await createUser();
      const wallet = await prisma.wallet.create({
        data: { userId: user.id, balance: 100 },
      });
      await prisma.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: 'PIX_DEPOSIT',
          status: 'COMPLETED',
          amount: 100,
          balanceAfter: 100,
          idempotencyKey: randomUUID(),
        },
      });

      const found = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        include: { wallet: { include: { transactions: true } } },
      });

      expect(found.wallet?.transactions).toHaveLength(1);
      expect(found.wallet?.transactions[0].amount.toNumber()).toBe(100);
    });
  });

  /**
   * MT-QA-02 — invariantes escritas à mão nas migrations
   * `20260822120000_tournament_tables_and_blinds` (MT-DB-05/06) e
   * `20260822140000_tournament_table_capacity`.
   *
   * Os INSERT/UPDATE sob teste são `$executeRaw`: o alvo é o banco, não o
   * service. Só as fixtures (`User`, `Tournament`) usam o client tipado, para
   * não repetir a dezena de colunas NOT NULL de `tournaments`.
   */
  describe('invariantes das mesas de torneio (MT-DB-05 / MT-DB-06)', () => {
    /**
     * `$executeRaw` devolve o erro CRU do Postgres — SQLSTATE `23505`
     * (unique_violation) + as colunas da chave — e não a mensagem
     * "Unique constraint failed" que o client tipado monta. A regex casa o
     * código e as colunas para provar QUAL índice parcial disparou (o nome do
     * índice não vem na mensagem).
     */
    const uniqueViolationOn = (keyColumns: string) =>
      new RegExp(`23505[\\s\\S]*Key \\(${keyColumns}\\)`);

    const createTournament = (createdById: string) =>
      prisma.tournament.create({
        data: {
          name: 'Torneio de teste',
          buyIn: 100,
          fee: 10,
          startingStack: 20000,
          maxPlayers: 100,
          startsAt: new Date(),
          createdById,
        },
      });

    /** `updated_at` não tem DEFAULT no banco (`@updatedAt` é do client). */
    const insertTable = (
      tournamentId: string,
      tableNumber: number,
      capacity: number,
    ) =>
      prisma.$executeRaw`
        INSERT INTO tournament_tables (id, tournament_id, table_number, capacity, updated_at)
        VALUES (${randomUUID()}, ${tournamentId}, ${tableNumber}, ${capacity}, NOW())`;

    const insertEntry = (
      tournamentId: string,
      userId: string,
      status: string,
    ) =>
      prisma.$executeRaw`
        INSERT INTO tournament_entries (id, tournament_id, user_id, status, chip_stack)
        VALUES (${randomUUID()}, ${tournamentId}, ${userId}, ${status}::"TournamentEntryStatus", 20000)`;

    const insertSeat = (
      tournamentTableId: string,
      tournamentEntryId: string,
      seatNumber: number,
      active: boolean,
    ) =>
      prisma.$executeRaw`
        INSERT INTO tournament_seats (id, tournament_table_id, tournament_entry_id, seat_number, active, reason, released_at)
        VALUES (${randomUUID()}, ${tournamentTableId}, ${tournamentEntryId}, ${seatNumber}, ${active}, 'INITIAL', ${
          active ? null : new Date()
        })`;

    /** Torneio + 1 mesa + N entries, o cenário mínimo de todo teste de assento. */
    const seatFixture = async (entryCount = 2) => {
      const admin = await createUser();
      const tournament = await createTournament(admin.id);
      await insertTable(tournament.id, 1, 9);
      const table = await prisma.tournamentTable.findFirstOrThrow({
        where: { tournamentId: tournament.id },
      });

      for (let i = 0; i < entryCount; i += 1) {
        const player = await createUser();
        await insertEntry(tournament.id, player.id, 'REGISTERED');
      }
      const entries = await prisma.tournamentEntry.findMany({
        where: { tournamentId: tournament.id },
        orderBy: { registeredAt: 'asc' },
      });

      return { tournament, table, entries };
    };

    describe('UNIQUE parcial tournament_seats_active_seat_unique', () => {
      it('rejeita dois assentos active no mesmo (mesa, seat_number)', async () => {
        const { table, entries } = await seatFixture();

        await insertSeat(table.id, entries[0].id, 3, true);

        await expect(
          insertSeat(table.id, entries[1].id, 3, true),
        ).rejects.toThrow(
          uniqueViolationOn('tournament_table_id, seat_number'),
        );
      });

      it('permite reocupar o assento depois que a ocupação anterior virou histórica', async () => {
        const { table, entries } = await seatFixture();

        await insertSeat(table.id, entries[0].id, 4, false);

        await expect(
          insertSeat(table.id, entries[1].id, 4, true),
        ).resolves.toBe(1);
      });
    });

    describe('UNIQUE parcial tournament_seats_active_entry_unique', () => {
      it('rejeita a mesma inscrição sentada em dois assentos active', async () => {
        const { tournament, table, entries } = await seatFixture(1);
        await insertTable(tournament.id, 2, 9);
        const other = await prisma.tournamentTable.findFirstOrThrow({
          where: { tournamentId: tournament.id, tableNumber: 2 },
        });

        await insertSeat(table.id, entries[0].id, 1, true);

        await expect(
          insertSeat(other.id, entries[0].id, 1, true),
        ).rejects.toThrow(uniqueViolationOn('tournament_entry_id'));
      });

      it('permite mover a inscrição depois de liberar o assento de origem', async () => {
        const { tournament, table, entries } = await seatFixture(1);
        await insertTable(tournament.id, 2, 9);
        const other = await prisma.tournamentTable.findFirstOrThrow({
          where: { tournamentId: tournament.id, tableNumber: 2 },
        });

        await insertSeat(table.id, entries[0].id, 1, false);

        await expect(
          insertSeat(other.id, entries[0].id, 1, true),
        ).resolves.toBe(1);
      });
    });

    describe('CHECK tournament_tables_capacity_valid', () => {
      it.each([11, 1])('rejeita capacity = %i', async (capacity) => {
        const admin = await createUser();
        const tournament = await createTournament(admin.id);

        await expect(insertTable(tournament.id, 1, capacity)).rejects.toThrow(
          /constraint|check/i,
        );
      });

      it('aceita capacity = 9 (full-ring)', async () => {
        const admin = await createUser();
        const tournament = await createTournament(admin.id);

        await expect(insertTable(tournament.id, 1, 9)).resolves.toBe(1);
      });
    });

    describe('CHECK blind_levels_blinds_valid / tournament_blind_levels_blinds_valid', () => {
      const insertBlindLevel = (
        structureId: string,
        bigBlind: number,
        durationSeconds: number,
      ) =>
        prisma.$executeRaw`
          INSERT INTO blind_levels (id, blind_structure_id, level_number, small_blind, big_blind, duration_seconds)
          VALUES (${randomUUID()}, ${structureId}, 1, 100, ${bigBlind}, ${durationSeconds})`;

      const insertTournamentBlindLevel = (
        tournamentId: string,
        bigBlind: number,
        durationSeconds: number,
      ) =>
        prisma.$executeRaw`
          INSERT INTO tournament_blind_levels (id, tournament_id, level_number, small_blind, big_blind, duration_seconds)
          VALUES (${randomUUID()}, ${tournamentId}, 1, 100, ${bigBlind}, ${durationSeconds})`;

      const createStructure = async () => {
        const admin = await createUser();
        return prisma.blindStructure.create({
          data: { name: 'Turbo 20min', createdById: admin.id },
        });
      };

      it('rejeita big_blind < small_blind no preset', async () => {
        const structure = await createStructure();

        await expect(insertBlindLevel(structure.id, 50, 600)).rejects.toThrow(
          /constraint|check/i,
        );
      });

      it('rejeita duration_seconds = 0 no preset (travaria o relógio no nível)', async () => {
        const structure = await createStructure();

        await expect(insertBlindLevel(structure.id, 200, 0)).rejects.toThrow(
          /constraint|check/i,
        );
      });

      it('rejeita big_blind < small_blind na cópia por valor do torneio', async () => {
        const admin = await createUser();
        const tournament = await createTournament(admin.id);

        await expect(
          insertTournamentBlindLevel(tournament.id, 50, 600),
        ).rejects.toThrow(/constraint|check/i);
      });

      it('rejeita duration_seconds = 0 na cópia por valor do torneio', async () => {
        const admin = await createUser();
        const tournament = await createTournament(admin.id);

        await expect(
          insertTournamentBlindLevel(tournament.id, 200, 0),
        ).rejects.toThrow(/constraint|check/i);
      });

      it('aceita um nível coerente na cópia por valor do torneio', async () => {
        const admin = await createUser();
        const tournament = await createTournament(admin.id);

        await expect(
          insertTournamentBlindLevel(tournament.id, 200, 600),
        ).resolves.toBe(1);
      });
    });

    describe('CHECK tournaments_clock_state_coherent', () => {
      it('rejeita RUNNING sem level_ends_at', async () => {
        const admin = await createUser();
        const tournament = await createTournament(admin.id);

        await expect(
          prisma.$executeRaw`UPDATE tournaments SET clock_status = 'RUNNING' WHERE id = ${tournament.id}`,
        ).rejects.toThrow(/constraint|check/i);
      });

      it('rejeita PAUSED sem clock_remaining_ms (o resto do nível se perderia)', async () => {
        const admin = await createUser();
        const tournament = await createTournament(admin.id);

        await expect(
          prisma.$executeRaw`UPDATE tournaments SET clock_status = 'PAUSED' WHERE id = ${tournament.id}`,
        ).rejects.toThrow(/constraint|check/i);
      });

      it('aceita RUNNING com level_ends_at preenchido e clock_remaining_ms nulo', async () => {
        const admin = await createUser();
        const tournament = await createTournament(admin.id);

        await expect(
          prisma.$executeRaw`
            UPDATE tournaments
               SET clock_status = 'RUNNING', current_level_number = 1, level_ends_at = NOW() + INTERVAL '10 minutes'
             WHERE id = ${tournament.id}`,
        ).resolves.toBe(1);
      });
    });

    describe('CHECK tournaments_table_capacity_valid', () => {
      it('rejeita table_capacity = 11', async () => {
        const admin = await createUser();
        const tournament = await createTournament(admin.id);

        await expect(
          prisma.$executeRaw`UPDATE tournaments SET table_capacity = 11 WHERE id = ${tournament.id}`,
        ).rejects.toThrow(/constraint|check/i);
      });
    });

    describe('UNIQUE parcial tournament_entries_active_user_unique (reentry, MT-DB-06)', () => {
      it('rejeita duas inscrições vivas do mesmo jogador no mesmo torneio', async () => {
        const admin = await createUser();
        const tournament = await createTournament(admin.id);
        const player = await createUser();

        await insertEntry(tournament.id, player.id, 'REGISTERED');

        // PLAYING também está no predicado do índice: o par (REGISTERED, PLAYING)
        // é justamente a corrida "cliquei duas vezes durante o late reg".
        await expect(
          insertEntry(tournament.id, player.id, 'PLAYING'),
        ).rejects.toThrow(uniqueViolationOn('tournament_id, user_id'));
      });

      it('permite reentry depois da eliminação', async () => {
        const admin = await createUser();
        const tournament = await createTournament(admin.id);
        const player = await createUser();

        await insertEntry(tournament.id, player.id, 'ELIMINATED');

        await expect(
          insertEntry(tournament.id, player.id, 'REGISTERED'),
        ).resolves.toBe(1);
      });
    });
  });
});
