import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  bootstrapTestApp,
  creditWallet,
  expectSeatInvariants,
  prismaDirect,
  registerAndLogin,
} from './tournament-helpers';

/**
 * MT-QA-01 — concorrência e TRANSACIONALIDADE do balanceamento de mesas.
 *
 * ESCOPO: o que só o Postgres real pode falsificar — lock, atomicidade,
 * idempotência sob replay simultâneo. A CORREÇÃO da regra de balanceamento
 * (quem sai, para onde vai, quando quebra) é de `seating.spec.ts`, que a cobre
 * exaustivamente com teste de propriedade; aqui nunca se afirma uma
 * distribuição exata, só INVARIANTES (`expectSeatInvariants`).
 *
 * Todo cenário termina em `expectSeatInvariants`, que é o gate de fato:
 * ninguém no ar, ninguém em dois assentos, ninguém em mesa fechada,
 * ocupação com diferença <= 1 enquanto houver vaga.
 */

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

interface Player {
  accessToken: string;
  userId: string;
}

async function seedPlayers(
  app: INestApplication<App>,
  count: number,
): Promise<Player[]> {
  const players = await Promise.all(
    Array.from({ length: count }, () => registerAndLogin(app)),
  );
  await Promise.all(players.map((p) => creditWallet(p.userId, '500.00')));
  return players;
}

async function createTournament(
  app: INestApplication<App>,
  adminToken: string,
  overrides: Record<string, unknown>,
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/tournaments')
    .set(auth(adminToken))
    .send({
      name: `MT-QA-01 ${randomUUID()}`,
      buyIn: '10.00',
      fee: '1.00',
      startingStack: 5000,
      maxPlayers: 24,
      startsAt: new Date(Date.now() + 3_600_000).toISOString(),
      prizes: [{ position: 1, percentage: '100.00' }],
      ...overrides,
    })
    .expect(201);
  return res.body.id as string;
}

const registerEntry = (
  app: INestApplication<App>,
  tournamentId: string,
  token: string,
  idempotencyKey: string = randomUUID(),
) =>
  request(app.getHttpServer())
    .post(`/api/tournaments/${tournamentId}/register`)
    .set(auth(token))
    .set('Idempotency-Key', idempotencyKey);

const eliminateEntry = (
  app: INestApplication<App>,
  tournamentId: string,
  entryId: string,
  adminToken: string,
) =>
  request(app.getHttpServer())
    .post(`/api/tournaments/${tournamentId}/entries/${entryId}/eliminate`)
    .set(auth(adminToken))
    .send({});

/** Mesas com a ocupação ATIVA, lidas direto do banco. */
function readTables(tournamentId: string) {
  return prismaDirect.tournamentTable.findMany({
    where: { tournamentId },
    orderBy: { tableNumber: 'asc' },
    include: { seats: { where: { active: true } } },
  });
}

/** Um id de entry viva por mesa aberta, na ordem das mesas. */
async function aliveEntryPerTable(tournamentId: string): Promise<string[]> {
  const tables = await readTables(tournamentId);
  return tables
    .filter((t) => t.status === 'OPEN' && t.seats.length > 0)
    .map((t) => t.seats[0].tournamentEntryId);
}

describe('Mesas de torneio — concorrência (MT-QA-01)', () => {
  let app: INestApplication<App>;
  let admin: Player;

  beforeAll(async () => {
    app = await bootstrapTestApp();
    admin = await registerAndLogin(app, { admin: true });
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await prismaDirect.$disconnect();
  });

  // Cenário 1 — distribuição inicial concorrente.
  it('20 inscrições simultâneas em mesas de 9: ninguém no ar, ninguém em assento duplicado', async () => {
    const players = await seedPlayers(app, 20);
    const tournamentId = await createTournament(app, admin.accessToken, {
      maxPlayers: 20,
      tableCapacity: 9,
    });

    const responses = await Promise.all(
      players.map((p) => registerEntry(app, tournamentId, p.accessToken)),
    );

    // Toda inscrição concluiu COM ticket: 201 e mesa/assento preenchidos.
    // Um 409 aqui significaria que a corrida derrubou uma inscrição legítima.
    expect(
      responses
        .filter((r) => r.status !== 201)
        .map((r) => `${r.status}: ${r.body.message}`),
    ).toEqual([]);
    expect(
      responses.every(
        (r) => r.body.tableNumber !== null && r.body.seatNumber !== null,
      ),
    ).toBe(true);
    expect(new Set(responses.map((r) => r.body.id as string)).size).toBe(20);

    // 20 jogadores / capacidade 9 = 3 mesas, sempre. A DISTRIBUIÇÃO entre
    // elas (7/7/6, 7/6/7, ...) depende da ordem de commit e não é afirmada.
    const tables = await readTables(tournamentId);
    expect(tables.filter((t) => t.status === 'OPEN')).toHaveLength(3);
    expect(tables.reduce((n, t) => n + t.seats.length, 0)).toBe(20);
    await expectSeatInvariants(tournamentId);
  }, 120_000);

  // Cenário 2 — duas eliminações simultâneas em MESAS DIFERENTES, no ponto em
  // que o rebalanceamento realmente age (7 jogadores em mesas de 3 = 3/2/2,
  // uma eliminação abaixo do limiar de quebra).
  it('duas eliminações simultâneas em mesas diferentes disparam quebra sem duplicar assento', async () => {
    const players = await seedPlayers(app, 7);
    const tournamentId = await createTournament(app, admin.accessToken, {
      maxPlayers: 7,
      tableCapacity: 3,
    });

    for (const player of players) {
      await registerEntry(app, tournamentId, player.accessToken).expect(201);
    }
    const tablesBefore = await readTables(tournamentId);
    expect(tablesBefore).toHaveLength(3);
    await expectSeatInvariants(tournamentId);

    const [fromTable1, fromTable2] = await aliveEntryPerTable(tournamentId);
    const results = await Promise.all([
      eliminateEntry(app, tournamentId, fromTable1, admin.accessToken),
      eliminateEntry(app, tournamentId, fromTable2, admin.accessToken),
    ]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);

    // 7 - 2 = 5 vivos, uma mesa quebrada e ninguém movido duas vezes.
    const tables = await readTables(tournamentId);
    expect(tables.reduce((n, t) => n + t.seats.length, 0)).toBe(5);
    expect(tables.filter((t) => t.status === 'CLOSED')).toHaveLength(1);
    expect(
      tables
        .filter((t) => t.status === 'CLOSED')
        .every((t) => t.seats.length === 0),
    ).toBe(true);

    // Prova de que o rebalanceamento rodou dentro da transação (e não só a
    // liberação do assento): alguém mudou de mesa com reason = BREAK.
    const moved = await prismaDirect.tournamentSeat.count({
      where: {
        active: true,
        reason: 'BREAK',
        tournamentTable: { tournamentId },
      },
    });
    expect(moved).toBeGreaterThan(0);
    await expectSeatInvariants(tournamentId);
  }, 60_000);

  // Cenário 3 — quebra de mesa sob concorrência, do começo ao fim do torneio.
  it('eliminações concorrentes até o fim: mesa fechada fica vazia e ninguém aponta para CLOSED', async () => {
    const players = await seedPlayers(app, 9);
    const tournamentId = await createTournament(app, admin.accessToken, {
      maxPlayers: 9,
      tableCapacity: 3,
    });

    for (const player of players) {
      await registerEntry(app, tournamentId, player.accessToken).expect(201);
    }
    expect(await readTables(tournamentId)).toHaveLength(3);

    // Vai eliminando aos PARES concorrentes — cada rodada atravessa (ou não) o
    // limiar de quebra, e a invariante é conferida a cada commit.
    for (;;) {
      const alive = await prismaDirect.tournamentEntry.findMany({
        where: { tournamentId, status: { in: ['REGISTERED', 'PLAYING'] } },
        select: { id: true },
        orderBy: { registeredAt: 'asc' },
      });
      if (alive.length < 3) break;

      const results = await Promise.all(
        [alive[0].id, alive[alive.length - 1].id].map((entryId) =>
          eliminateEntry(app, tournamentId, entryId, admin.accessToken),
        ),
      );
      expect(results.map((r) => r.status)).toEqual([201, 201]);
      await expectSeatInvariants(tournamentId);
    }

    const tables = await readTables(tournamentId);
    const closed = tables.filter((t) => t.status === 'CLOSED');
    expect(closed.length).toBeGreaterThan(0);
    expect(closed.every((t) => t.seats.length === 0)).toBe(true);
    expect(tables.filter((t) => t.status === 'OPEN')).toHaveLength(1);
  }, 60_000);

  // Cenário 4 — replay de idempotência SIMULTÂNEO.
  it('mesma Idempotency-Key disparada 2x em paralelo: 1 entry, 1 assento, mesmo ticket', async () => {
    const [player] = await seedPlayers(app, 1);
    const tournamentId = await createTournament(app, admin.accessToken, {
      maxPlayers: 4,
      tableCapacity: 9,
    });

    const key = randomUUID();
    const [first, second] = await Promise.all([
      registerEntry(app, tournamentId, player.accessToken, key),
      registerEntry(app, tournamentId, player.accessToken, key),
    ]);

    expect([first.status, second.status]).toEqual([201, 201]);
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.tableNumber).toBe(first.body.tableNumber);
    expect(second.body.seatNumber).toBe(first.body.seatNumber);
    expect(first.body.tableNumber).not.toBeNull();

    expect(
      await prismaDirect.tournamentEntry.count({ where: { tournamentId } }),
    ).toBe(1);
    expect(
      await prismaDirect.tournamentSeat.count({
        where: { tournamentTable: { tournamentId } },
      }),
    ).toBe(1);
    // Um único débito no ledger — o replay não cobrou o buy-in duas vezes.
    expect(
      await prismaDirect.walletTransaction.count({
        where: { type: 'TOURNAMENT_BUY_IN', tournamentEntry: { tournamentId } },
      }),
    ).toBe(1);
    await expectSeatInvariants(tournamentId);
  }, 60_000);

  // Cenário 5 — reentry (rota (a)) concorrente com eliminação.
  it('reentrada e eliminação simultâneas: entry antiga intacta, nova com assento próprio', async () => {
    const players = await seedPlayers(app, 6);
    const tournamentId = await createTournament(app, admin.accessToken, {
      maxPlayers: 6,
      tableCapacity: 3,
      allowReentry: true,
    });

    const entryIds: string[] = [];
    for (const player of players) {
      const res = await registerEntry(
        app,
        tournamentId,
        player.accessToken,
      ).expect(201);
      entryIds.push(res.body.id as string);
    }

    // Elimina quem vai reentrar (o torneio passa a RUNNING aqui).
    await eliminateEntry(
      app,
      tournamentId,
      entryIds[0],
      admin.accessToken,
    ).expect(201);
    await expectSeatInvariants(tournamentId);

    // Concorrentes: a reentrada de players[0] e a eliminação de players[5].
    // Uma SENTA e a outra REBALANCEIA ao mesmo tempo, sobre as mesmas mesas.
    const [reentry, elimination] = await Promise.all([
      registerEntry(app, tournamentId, players[0].accessToken),
      eliminateEntry(app, tournamentId, entryIds[5], admin.accessToken),
    ]);
    expect([reentry.status, elimination.status]).toEqual([201, 201]);
    expect(reentry.body.id).not.toBe(entryIds[0]);
    expect(reentry.body.tableNumber).not.toBeNull();

    // Histórico da entry antiga intacto e terminal.
    const old = await prismaDirect.tournamentEntry.findUniqueOrThrow({
      where: { id: entryIds[0] },
      include: { seats: true },
    });
    expect(old.status).toBe('ELIMINATED');
    expect(old.seats.length).toBeGreaterThan(0);
    expect(old.seats.every((s) => !s.active)).toBe(true);

    // A entry nova tem assento PRÓPRIO, ativo, e não herdou o antigo.
    const fresh = await prismaDirect.tournamentSeat.findMany({
      where: { tournamentEntryId: reentry.body.id as string, active: true },
    });
    expect(fresh).toHaveLength(1);
    expect(old.seats.map((s) => s.id)).not.toContain(fresh[0].id);

    expect(
      await prismaDirect.tournamentEntry.count({
        where: { tournamentId, userId: players[0].userId },
      }),
    ).toBe(2);
    await expectSeatInvariants(tournamentId);
  }, 60_000);
});
