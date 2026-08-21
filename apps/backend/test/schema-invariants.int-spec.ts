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
});
