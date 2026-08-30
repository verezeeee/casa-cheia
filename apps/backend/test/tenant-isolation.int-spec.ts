import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

/**
 * CL-DB-03 — isolamento entre clubes por Row-Level Security nativo do
 * Postgres (migration `20260829000000_rls_clube_isolation`).
 *
 * O QUE ESTÁ SOB TESTE É O BANCO, NÃO A APLICAÇÃO. Todas as consultas abaixo
 * são CRUAS e PROPOSITALMENTE SEM `WHERE clube_id` — elas simulam exatamente o
 * bug que a RLS existe para conter: um filtro de tenant esquecido na camada de
 * aplicação. Se qualquer uma delas voltar a enxergar dado do outro clube, o
 * isolamento não existe, por mais correto que esteja o service.
 *
 * PRECISA CONECTAR COMO `poker_app`, não como o owner: RLS é ignorada para
 * SUPERUSER, e o `poker` do docker-compose/CI é o superuser do cluster. Uma
 * suíte que usasse `DATABASE_URL` passaria com as policies REMOVIDAS — não
 * provaria nada. Daí os dois clients: `owner` monta as fixtures (enxerga
 * tudo), `app` é quem está sob teste.
 *
 * Roda contra Postgres real (`DATABASE_URL_APP_TEST`, ver test/setup-env.ts).
 */
describe('Isolamento entre clubes (RLS, Postgres real)', () => {
  /** Owner/superuser: aplica as fixtures sem esbarrar nas policies. */
  const owner = new PrismaClient();

  /** Role da aplicação: NOSUPERUSER, NOBYPASSRLS, não é dono de nada. */
  const app = new PrismaClient({
    datasourceUrl: process.env.DATABASE_URL_APP_TEST,
  });

  let clubeA: string;
  let clubeB: string;
  let tableA: string;
  let tableB: string;
  let walletA: string;
  let walletB: string;
  let txB: string;
  let pixChargeB: string;
  let pixWithdrawalB: string;
  let userId: string;

  /**
   * Abre uma transação JÁ COM contexto de tenant — a mesma sequência que
   * CL-BE-01 vai executar em produção. Precisa ser transação interativa (e não
   * `app.$queryRaw` solto): o pool pode servir cada statement por uma conexão
   * diferente, e o `set_config` local ficaria numa sessão que não é a da
   * consulta seguinte.
   *
   * O terceiro argumento `true` de `set_config` = LOCAL À TRANSAÇÃO: o valor
   * morre no commit e não vaza para a próxima requisição que reaproveitar a
   * conexão do pool. Vazar aqui seria pior que não ter RLS — a requisição
   * seguinte herdaria o tenant da anterior.
   */
  const asClube = <T>(
    clubeId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> =>
    app.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_clube_id', ${clubeId}, true)`;
      return fn(tx);
    });

  const createClube = async () => {
    const clube = await owner.clube.create({
      data: {
        name: `Clube ${randomUUID().slice(0, 8)}`,
        document: randomUUID().replaceAll('-', '').slice(0, 14),
      },
    });
    return clube.id;
  };

  const createTable = async (clubeId: string) => {
    const table = await owner.table.create({
      data: {
        name: 'Mesa do tenant',
        type: 'CASH_GAME',
        smallBlind: 1,
        bigBlind: 2,
        minBuyIn: 100,
        maxBuyIn: 500,
        maxSeats: 6,
        status: 'OPEN',
        createdById: userId,
        clubeId,
      },
    });
    return table.id;
  };

  const createWallet = async (clubeId: string) => {
    const wallet = await owner.wallet.create({
      data: { userId, clubeId, balance: 100 },
    });
    await owner.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: 'PIX_DEPOSIT',
        status: 'COMPLETED',
        amount: 100,
        balanceAfter: 100,
        idempotencyKey: randomUUID(),
      },
    });
    return wallet.id;
  };

  beforeAll(async () => {
    await ensureAppRole(owner);

    const user = await owner.user.create({
      data: {
        email: `${randomUUID()}@tenant-isolation.test`,
        passwordHash: 'hash-fake-nao-usado-neste-teste',
        name: 'Jogador dos dois clubes',
      },
    });
    userId = user.id;

    clubeA = await createClube();
    clubeB = await createClube();

    tableA = await createTable(clubeA);
    tableB = await createTable(clubeB);

    // Torneio em cada clube: `tournaments` é a raiz de escopo das filhas
    // (`tournament_tables`, `tournament_prizes`, ...), e o torneio de B é o
    // alvo de vazamento que o contexto A não pode enxergar.
    for (const clubeId of [clubeA, clubeB]) {
      await owner.tournament.create({
        data: {
          name: 'Torneio do tenant',
          buyIn: 100,
          fee: 10,
          startingStack: 20000,
          maxPlayers: 100,
          startsAt: new Date(),
          createdById: userId,
          clubeId,
        },
      });
    }

    walletA = await createWallet(clubeA);
    walletB = await createWallet(clubeB);

    const transacaoB = await owner.walletTransaction.findFirstOrThrow({
      where: { walletId: walletB },
    });
    txB = transacaoB.id;

    // `pix_charges`/`pix_withdrawals` (CL-BE-07): a lacuna que CL-DB-03 deixou
    // documentada — sem `clube_id` próprio não dava pra escopá-las. Fixture
    // do clube B, alvo de vazamento que o contexto A não pode enxergar.
    const chargeB = await owner.pixCharge.create({
      data: {
        userId,
        clubeId: clubeB,
        externalId: `chg-${randomUUID()}`,
        amount: 50,
        status: 'PENDING',
        qrCodePayload: '000201...',
        expiresAt: new Date(Date.now() + 30 * 60_000),
        rawPayload: {},
      },
    });
    pixChargeB = chargeB.id;

    const withdrawalB = await owner.pixWithdrawal.create({
      data: {
        userId,
        clubeId: clubeB,
        amount: 20,
        pixKey: 'jogador@pix.dev',
        pixKeyType: 'EMAIL',
        status: 'REQUESTED',
      },
    });
    pixWithdrawalB = withdrawalB.id;
  });

  afterAll(async () => {
    await Promise.all([owner.$disconnect(), app.$disconnect()]);
  });

  describe('leitura (USING)', () => {
    it('não enxerga a mesa do clube B sob contexto do clube A', async () => {
      const rows = await asClube(
        clubeA,
        (tx) => tx.$queryRaw<{ id: string }[]>`SELECT id FROM tables`,
      );
      const ids = rows.map((r) => r.id);

      expect(ids).toContain(tableA);
      expect(ids).not.toContain(tableB);
    });

    it('não enxerga o torneio do clube B sob contexto do clube A', async () => {
      const rows = await asClube(
        clubeA,
        (tx) =>
          tx.$queryRaw<
            { clube_id: string }[]
          >`SELECT clube_id FROM tournaments`,
      );

      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.clube_id === clubeA)).toBe(true);
    });

    it('não enxerga o extrato do clube B (tabela filha, escopo herdado da wallet)', async () => {
      const rows = await asClube(
        clubeA,
        (tx) =>
          tx.$queryRaw<{ id: string }[]>`SELECT id FROM wallet_transactions`,
      );

      expect(rows.map((r) => r.id)).not.toContain(txB);
    });

    it('não enxerga a cobrança PIX do clube B (CL-BE-07: fecha a lacuna de CL-DB-03)', async () => {
      const rows = await asClube(
        clubeA,
        (tx) => tx.$queryRaw<{ id: string }[]>`SELECT id FROM pix_charges`,
      );

      expect(rows.map((r) => r.id)).not.toContain(pixChargeB);
    });

    it('não enxerga o saque PIX do clube B (CL-BE-07: fecha a lacuna de CL-DB-03)', async () => {
      const rows = await asClube(
        clubeA,
        (tx) => tx.$queryRaw<{ id: string }[]>`SELECT id FROM pix_withdrawals`,
      );

      expect(rows.map((r) => r.id)).not.toContain(pixWithdrawalB);
    });
  });

  describe('escrita (USING + WITH CHECK)', () => {
    it('UPDATE sem filtro de clube afeta 0 linhas na mesa do clube B', async () => {
      const affected = await asClube(
        clubeA,
        (tx) =>
          tx.$executeRaw`UPDATE tables SET status = 'CLOSED' WHERE id = ${tableB}`,
      );

      expect(affected).toBe(0);

      // E a linha continua intacta: `USING` filtrou, não mascarou.
      const table = await owner.table.findUniqueOrThrow({
        where: { id: tableB },
      });
      expect(table.status).toBe('OPEN');
    });

    it('UPDATE na mesa do próprio clube funciona (controle positivo)', async () => {
      const affected = await asClube(
        clubeA,
        (tx) =>
          tx.$executeRaw`UPDATE tables SET status = 'PAUSED' WHERE id = ${tableA}`,
      );

      expect(affected).toBe(1);
    });

    it('INSERT com clube_id de outro tenant é recusado pelo WITH CHECK', async () => {
      await expect(
        asClube(
          clubeA,
          (tx) =>
            tx.$executeRaw`
              INSERT INTO tables (id, clube_id, name, type, small_blind, big_blind, min_buy_in, max_buy_in, max_seats, status, created_by_id, updated_at)
              VALUES (${randomUUID()}, ${clubeB}, 'Mesa plantada', 'CASH_GAME'::"TableType", 1, 2, 100, 500, 6, 'OPEN'::"TableStatus", ${userId}, NOW())`,
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it('INSERT no próprio clube passa (controle positivo)', async () => {
      await expect(
        asClube(
          clubeA,
          (tx) =>
            tx.$executeRaw`
              INSERT INTO tables (id, clube_id, name, type, small_blind, big_blind, min_buy_in, max_buy_in, max_seats, status, created_by_id, updated_at)
              VALUES (${randomUUID()}, ${clubeA}, 'Mesa legítima', 'CASH_GAME'::"TableType", 1, 2, 100, 500, 6, 'OPEN'::"TableStatus", ${userId}, NOW())`,
        ),
      ).resolves.toBe(1);
    });

    it('INSERT em pix_charges com clube_id de outro tenant é recusado pelo WITH CHECK (CL-BE-07)', async () => {
      await expect(
        asClube(
          clubeA,
          (tx) =>
            tx.$executeRaw`
              INSERT INTO pix_charges (id, "userId", clube_id, "externalId", amount, status, "qrCodePayload", "expiresAt", "rawPayload", "updatedAt")
              VALUES (${randomUUID()}, ${userId}, ${clubeB}, ${`chg-${randomUUID()}`}, 10, 'PENDING'::"PixChargeStatus", '000201...', NOW() + interval '30 minutes', '{}'::jsonb, NOW())`,
        ),
      ).rejects.toThrow(/row-level security/i);
    });
  });

  describe('fail-closed (sem contexto de clube)', () => {
    /**
     * O ponto do `missing_ok = true` em `current_setting`. Sem ele o Postgres
     * levantaria 42704 e todo endpoint que esquecesse de abrir o contexto
     * viraria HTTP 500 em vez de "não encontrado". Aqui a transação NÃO chama
     * `set_config`: o esperado é ZERO LINHAS, sem erro.
     */
    it('retorna 0 linhas (e não erro) em tables sem set_config', async () => {
      const rows = await app.$transaction(
        (tx) => tx.$queryRaw<{ id: string }[]>`SELECT id FROM tables`,
      );

      expect(rows).toHaveLength(0);
    });

    it('retorna 0 linhas em wallets sem set_config', async () => {
      const rows = await app.$transaction(
        (tx) => tx.$queryRaw<{ id: string }[]>`SELECT id FROM wallets`,
      );

      expect(rows).toHaveLength(0);
    });
  });

  describe('lock pessimista da carteira (mesmo shape de WalletService.applyLedgerEntry)', () => {
    /**
     * `SELECT ... FOR UPDATE` é o caminho por onde o dinheiro passa. Se a RLS
     * não valesse aqui, um `walletId` de outro clube vazado para o service
     * debitaria a carteira alheia — a policy tem que filtrar ANTES do lock.
     */
    const lockWallet = (clubeId: string, walletId: string) =>
      asClube(
        clubeId,
        (tx) =>
          tx.$queryRaw<
            { id: string; balance: unknown }[]
          >`SELECT id, balance FROM wallets WHERE id = ${walletId} FOR UPDATE`,
      );

    it('não trava (nem enxerga) a carteira do clube B sob contexto do clube A', async () => {
      await expect(lockWallet(clubeA, walletB)).resolves.toHaveLength(0);
    });

    it('trava a carteira do próprio clube (controle positivo)', async () => {
      await expect(lockWallet(clubeA, walletA)).resolves.toHaveLength(1);
    });
  });
});

/**
 * Garante o role `poker_app` no banco de teste.
 *
 * Localmente ele já vem de `docker/postgres/init/01-app-role.sql`, e esta
 * função é no-op. No CI não vem: os `services:` do GitHub Actions sobem ANTES
 * do checkout, então não há como montar o script de init no container. Sem
 * este bootstrap a suíte inteira falharia no CI por "role does not exist" — o
 * que seria lido como flake de infra, não como regressão de RLS.
 *
 * `ALTER ROLE ... PASSWORD` incondicional mantém a senha em sincronia com a
 * URL, evitando um role sobrevivente de execução anterior com senha antiga.
 *
 * DDL não aceita parâmetro vinculado (`CREATE ROLE $1` não existe), então os
 * comandos vão por `$executeRawUnsafe` com quoting manual. Os valores vêm de
 * `DATABASE_URL_APP_TEST` — ambiente do próprio runner, não de entrada de
 * usuário — e ainda assim são escapados.
 */
async function ensureAppRole(owner: PrismaClient): Promise<void> {
  const url = new URL(process.env.DATABASE_URL_APP_TEST as string);
  const role = `"${decodeURIComponent(url.username).replaceAll('"', '""')}"`;
  const password = `'${decodeURIComponent(url.password).replaceAll("'", "''")}'`;

  const [existing] = await owner.$queryRaw<
    { count: bigint }[]
  >`SELECT count(*) FROM pg_roles WHERE rolname = ${decodeURIComponent(url.username)}`;

  if (existing.count === 0n) {
    await owner.$executeRawUnsafe(
      `CREATE ROLE ${role} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT`,
    );
  }

  await owner.$executeRawUnsafe(`ALTER ROLE ${role} PASSWORD ${password}`);
  await owner.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${role}`);
  await owner.$executeRawUnsafe(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`,
  );
}
