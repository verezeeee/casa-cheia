import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
// Fixtures compartilhadas com `tournament-tables.e2e-spec.ts` (MT-QA-01).
import {
  bootstrapTestApp,
  createTestClube,
  creditWallet,
  expectSeatInvariants,
  prismaDirect,
  registerAndLogin,
} from './tournament-helpers';

describe('Tournaments (e2e)', () => {
  let app: INestApplication<App>;
  let CLUBE_ID: string;

  beforeAll(async () => {
    app = await bootstrapTestApp();
    CLUBE_ID = await createTestClube();
  });

  afterAll(async () => {
    await app.close();
    await prismaDirect.$disconnect();
  });

  it('PLAYER não pode criar torneio (403)', async () => {
    const { accessToken } = await registerAndLogin(app);
    await request(app.getHttpServer())
      .post(`/api/clubes/${CLUBE_ID}/torneios`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Proibido',
        buyIn: '10.00',
        fee: '1.00',
        startingStack: 1000,
        maxPlayers: 2,
        startsAt: new Date().toISOString(),
        prizes: [{ position: 1, percentage: '100.00' }],
      })
      .expect(403);
  });

  it('rejeita grade de premiação que não fecha 100%', async () => {
    const admin = await registerAndLogin(app, { admin: true });
    await request(app.getHttpServer())
      .post(`/api/clubes/${CLUBE_ID}/torneios`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({
        name: 'Grade inválida',
        buyIn: '10.00',
        fee: '1.00',
        startingStack: 1000,
        maxPlayers: 2,
        startsAt: new Date().toISOString(),
        prizes: [{ position: 1, percentage: '50.00' }],
      })
      .expect(400);
  });

  it('blind structures: cria preset -> lista -> 409 em uso -> deleta', async () => {
    const admin = await registerAndLogin(app, { admin: true });
    const player = await registerAndLogin(app);

    const levels = [
      { levelNumber: 1, smallBlind: 25, bigBlind: 50, durationSeconds: 1200 },
      {
        levelNumber: 2,
        smallBlind: 50,
        bigBlind: 100,
        ante: 100,
        durationSeconds: 1200,
      },
      {
        levelNumber: 3,
        smallBlind: 50,
        bigBlind: 100,
        durationSeconds: 900,
        isBreak: true,
        breakLabel: 'Intervalo · 15 min',
      },
    ];

    // Não-admin não cria preset.
    await request(app.getHttpServer())
      .post(`/api/clubes/${CLUBE_ID}/blind-structures`)
      .set('Authorization', `Bearer ${player.accessToken}`)
      .send({ name: 'Proibido', levels })
      .expect(403);

    // Sequência com buraco (1, 3) é rejeitada pelas validações de conjunto.
    await request(app.getHttpServer())
      .post(`/api/clubes/${CLUBE_ID}/blind-structures`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({
        name: 'Buraco',
        levels: [levels[0], { ...levels[1], levelNumber: 3 }],
      })
      .expect(400);

    // Intervalo sem rótulo é rejeitado.
    await request(app.getHttpServer())
      .post(`/api/clubes/${CLUBE_ID}/blind-structures`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({
        name: 'Break sem label',
        levels: [{ ...levels[0], isBreak: true }],
      })
      .expect(400);

    const createRes = await request(app.getHttpServer())
      .post(`/api/clubes/${CLUBE_ID}/blind-structures`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ name: 'Turbo 20min', levels })
      .expect(201);
    const structureId = createRes.body.id as string;
    expect(createRes.body.levels).toHaveLength(3);
    expect(createRes.body.levels[0]).toEqual({
      levelNumber: 1,
      smallBlind: 25,
      bigBlind: 50,
      ante: 0,
      durationSeconds: 1200,
      isBreak: false,
      breakLabel: null,
    });
    expect(createRes.body.levels[2]).toMatchObject({
      isBreak: true,
      breakLabel: 'Intervalo · 15 min',
    });

    // Leitura é liberada a qualquer usuário autenticado.
    const listRes = await request(app.getHttpServer())
      .get(`/api/clubes/${CLUBE_ID}/blind-structures`)
      .set('Authorization', `Bearer ${player.accessToken}`)
      .expect(200);
    expect((listRes.body as Array<{ id: string }>).map((s) => s.id)).toContain(
      structureId,
    );

    await request(app.getHttpServer())
      .get(`/api/clubes/${CLUBE_ID}/blind-structures/${structureId}`)
      .set('Authorization', `Bearer ${player.accessToken}`)
      .expect(200);

    // PUT substitui a grade inteira (3 níveis -> 2).
    const putRes = await request(app.getHttpServer())
      .put(`/api/clubes/${CLUBE_ID}/blind-structures/${structureId}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ name: 'Turbo 15min', levels: levels.slice(0, 2) })
      .expect(200);
    expect(putRes.body).toMatchObject({ name: 'Turbo 15min' });
    expect(putRes.body.levels).toHaveLength(2);

    // Preset referenciado por um torneio não pode ser excluído (409).
    // O vínculo é feito direto no banco porque `createTournament` só passa a
    // aceitar `blindStructureId` em MT-BE-03.
    const tournamentRes = await request(app.getHttpServer())
      .post(`/api/clubes/${CLUBE_ID}/torneios`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({
        name: 'Torneio com preset',
        buyIn: '10.00',
        fee: '1.00',
        startingStack: 1000,
        maxPlayers: 2,
        startsAt: new Date(Date.now() + 3_600_000).toISOString(),
        prizes: [{ position: 1, percentage: '100.00' }],
      })
      .expect(201);
    await prismaDirect.tournament.update({
      where: { id: tournamentRes.body.id as string },
      data: { blindStructureId: structureId },
    });

    await request(app.getHttpServer())
      .delete(`/api/clubes/${CLUBE_ID}/blind-structures/${structureId}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(409);

    await prismaDirect.tournament.update({
      where: { id: tournamentRes.body.id as string },
      data: { blindStructureId: null },
    });

    await request(app.getHttpServer())
      .delete(`/api/clubes/${CLUBE_ID}/blind-structures/${structureId}`)
      .set('Authorization', `Bearer ${player.accessToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .delete(`/api/clubes/${CLUBE_ID}/blind-structures/${structureId}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(204);

    await request(app.getHttpServer())
      .get(`/api/clubes/${CLUBE_ID}/blind-structures/${structureId}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(404);
  });

  // MT-BE-03..06 e MT-BE-09, no fluxo que o caixa realmente faz.
  it('mesas: inscrição senta -> eliminação quebra mesa -> redraw -> reentrada', async () => {
    const admin = await registerAndLogin(app, { admin: true });
    const players = await Promise.all([
      registerAndLogin(app),
      registerAndLogin(app),
      registerAndLogin(app),
      registerAndLogin(app),
    ]);
    await Promise.all(players.map((p) => creditWallet(p.userId, '200.00')));
    const auth = (index: number) => ({
      Authorization: `Bearer ${players[index].accessToken}`,
    });

    // Capacidade 2 de propósito: com 4 jogadores o torneio já passa por
    // abertura de mesa, quebra e redraw sem precisar de 20 fixtures.
    const createRes = await request(app.getHttpServer())
      .post(`/api/clubes/${CLUBE_ID}/torneios`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({
        name: 'Mesas MVP',
        buyIn: '10.00',
        fee: '1.00',
        startingStack: 5000,
        maxPlayers: 6,
        tableCapacity: 2,
        allowReentry: true,
        maxReentries: 1,
        startsAt: new Date(Date.now() + 3_600_000).toISOString(),
        prizes: [{ position: 1, percentage: '100.00' }],
      })
      .expect(201);
    const tournamentId = createRes.body.id as string;

    // --- Inscrições: cada uma devolve o ticket (mesa/assento) na hora.
    const entryIds: string[] = [];
    const lastKey: string[] = [];
    for (let index = 0; index < players.length; index += 1) {
      const key = randomUUID();
      const res = await request(app.getHttpServer())
        .post(`/api/clubes/${CLUBE_ID}/torneios/${tournamentId}/register`)
        .set(auth(index))
        .set('Idempotency-Key', key)
        .expect(201);
      entryIds.push(res.body.id as string);
      lastKey.push(key);
      expect(res.body.tableNumber).not.toBeNull();
      expect(res.body.seatNumber).not.toBeNull();
    }
    // Mesa 1 lota (2 assentos) e a 3ª inscrição abre a mesa 2.
    expect(entryIds).toHaveLength(4);
    await expectSeatInvariants(tournamentId);

    const seatOf = async (entryId: string) =>
      prismaDirect.tournamentSeat.findFirstOrThrow({
        where: { tournamentEntryId: entryId, active: true },
        include: { tournamentTable: true },
      });
    expect((await seatOf(entryIds[0])).tournamentTable.tableNumber).toBe(1);
    expect((await seatOf(entryIds[2])).tournamentTable.tableNumber).toBe(2);

    // Replay da MESMA Idempotency-Key devolve o MESMO ticket (armadilha 1).
    const original = await seatOf(entryIds[3]);
    const replay = await request(app.getHttpServer())
      .post(`/api/clubes/${CLUBE_ID}/torneios/${tournamentId}/register`)
      .set(auth(3))
      .set('Idempotency-Key', lastKey[3])
      .expect(201);
    expect(replay.body).toMatchObject({
      id: entryIds[3],
      tableNumber: original.tournamentTable.tableNumber,
      seatNumber: original.seatNumber,
    });

    // O detalhe do torneio também carrega mesa/assento (ticket do jogador).
    const detail = await request(app.getHttpServer())
      .get(`/api/clubes/${CLUBE_ID}/torneios/${tournamentId}`)
      .set(auth(0))
      .expect(200);
    expect(
      (detail.body.entries as Array<{ tableNumber: number | null }>).every(
        (e) => e.tableNumber !== null,
      ),
    ).toBe(true);

    // --- Eliminações: a 1ª só libera o assento; a 2ª cruza o limiar e QUEBRA
    // a mesa 2, movendo o sobrevivente para a mesa 1.
    for (const entryId of [entryIds[0], entryIds[2]]) {
      await request(app.getHttpServer())
        .post(
          `/api/clubes/${CLUBE_ID}/torneios/${tournamentId}/entries/${entryId}/eliminate`,
        )
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({})
        .expect(201);
      await expectSeatInvariants(tournamentId);
    }

    const moved = await seatOf(entryIds[3]);
    expect(moved.tournamentTable.tableNumber).toBe(1);
    expect(moved.reason).toBe('BREAK');
    expect(moved.fromTableId).not.toBeNull();
    const closed = await prismaDirect.tournamentTable.findFirstOrThrow({
      where: { tournamentId, tableNumber: 2 },
    });
    expect(closed.status).toBe('CLOSED');
    // O assento antigo virou histórico, não sumiu (append-only).
    expect(
      await prismaDirect.tournamentSeat.count({
        where: { tournamentEntryId: entryIds[0] },
      }),
    ).toBe(1);

    // --- Redraw manual: só ADMIN, e devolve o mapa novo.
    await request(app.getHttpServer())
      .post(`/api/clubes/${CLUBE_ID}/torneios/${tournamentId}/redraw`)
      .set(auth(1))
      .expect(403);

    const redrawRes = await request(app.getHttpServer())
      .post(`/api/clubes/${CLUBE_ID}/torneios/${tournamentId}/redraw`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(201);
    expect(redrawRes.body).toMatchObject({
      tournamentId,
      playersRemaining: 2,
      averageStack: 5000,
    });
    await expectSeatInvariants(tournamentId);
    const redrawSeats = await prismaDirect.tournamentSeat.findMany({
      where: { active: true, tournamentTable: { tournamentId } },
    });
    expect(
      redrawSeats.every(
        (s) => s.reason === 'MANUAL_REDRAW' && s.movedById !== null,
      ),
    ).toBe(true);

    // --- Reentrada do jogador eliminado: entry NOVA, assento NOVO, prize
    // pool incrementado; a entry antiga fica intacta.
    const reentryRes = await request(app.getHttpServer())
      .post(`/api/clubes/${CLUBE_ID}/torneios/${tournamentId}/register`)
      .set(auth(0))
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    expect(reentryRes.body.id).not.toBe(entryIds[0]);
    expect(reentryRes.body.tableNumber).not.toBeNull();
    await expectSeatInvariants(tournamentId);

    const oldEntry = await prismaDirect.tournamentEntry.findUniqueOrThrow({
      where: { id: entryIds[0] },
      include: { seats: true },
    });
    expect(oldEntry.status).toBe('ELIMINATED');
    expect(oldEntry.seats.every((s) => !s.active)).toBe(true);
    const withReentry = await prismaDirect.tournament.findUniqueOrThrow({
      where: { id: tournamentId },
    });
    expect(withReentry.prizePool.toFixed(2)).toBe('50.00'); // 5 buy-ins de 10

    // --- Limite de reentradas: a segunda reentrada do mesmo jogador é 400.
    await request(app.getHttpServer())
      .post(
        `/api/clubes/${CLUBE_ID}/torneios/${tournamentId}/entries/${reentryRes.body.id}/eliminate`,
      )
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({})
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/clubes/${CLUBE_ID}/torneios/${tournamentId}/register`)
      .set(auth(0))
      .set('Idempotency-Key', randomUUID())
      .expect(400);
    await expectSeatInvariants(tournamentId);
  });

  // MT-QA-03: o relógio de verdade, visto pela rota pública de TV.
  it('relógio + display: start -> pause congela -> resume -> next -> PATCH aplica delta -> previous no nível 1 = 400', async () => {
    const admin = await registerAndLogin(app, { admin: true });
    const player = await registerAndLogin(app);
    await creditWallet(player.userId, '100.00');
    const asAdmin = { Authorization: `Bearer ${admin.accessToken}` };

    const structureRes = await request(app.getHttpServer())
      .post(`/api/clubes/${CLUBE_ID}/blind-structures`)
      .set(asAdmin)
      .send({
        name: `Display ${randomUUID()}`,
        levels: [
          {
            levelNumber: 1,
            smallBlind: 25,
            bigBlind: 50,
            durationSeconds: 1200,
          },
          {
            levelNumber: 2,
            smallBlind: 50,
            bigBlind: 100,
            durationSeconds: 900,
          },
        ],
      })
      .expect(201);

    const createRes = await request(app.getHttpServer())
      .post(`/api/clubes/${CLUBE_ID}/torneios`)
      .set(asAdmin)
      .send({
        name: 'TV do salão',
        buyIn: '10.00',
        fee: '1.00',
        startingStack: 5000,
        maxPlayers: 4,
        startsAt: new Date(Date.now() + 3_600_000).toISOString(),
        blindStructureId: structureRes.body.id as string,
        prizes: [{ position: 1, percentage: '100.00' }],
      })
      .expect(201);
    const tournamentId = createRes.body.id as string;

    await request(app.getHttpServer())
      .post(`/api/clubes/${CLUBE_ID}/torneios/${tournamentId}/register`)
      .set('Authorization', `Bearer ${player.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .expect(201);

    const display = (path: 'clock' | 'tables') =>
      request(app.getHttpServer())
        .get(`/api/display/tournaments/${tournamentId}/${path}`)
        .expect(200);

    // --- SEM Authorization: as duas rotas de TV respondem 200 e proíbem cache.
    const beforeStart = await display('clock');
    expect(beforeStart.headers['cache-control']).toBe('no-store');
    expect(beforeStart.body).toMatchObject({
      clockStatus: 'NOT_STARTED',
      currentLevel: null,
      levelEndsAt: null,
      remainingMs: 0,
    });
    expect(typeof beforeStart.body.serverTime).toBe('string');

    // --- start: o display passa a ver RUNNING no nível 1.
    await request(app.getHttpServer())
      .post(`/api/clubes/${CLUBE_ID}/torneios/${tournamentId}/clock/start`)
      .set(asAdmin)
      .expect(201);

    const running = await display('clock');
    expect(running.body).toMatchObject({ clockStatus: 'RUNNING' });
    expect(running.body.currentLevel).toMatchObject({
      levelNumber: 1,
      smallBlind: 25,
      bigBlind: 50,
    });
    expect(running.body.nextLevel).toMatchObject({ levelNumber: 2 });
    expect(running.body.remainingMs).toBeLessThanOrEqual(1_200_000);
    expect(running.body.remainingMs).toBeGreaterThan(1_190_000);

    // Duas TVs consultando em sequência veem o MESMO fim de nível (o servidor
    // é a fonte única) e o restante só ANDA PARA TRÁS.
    const secondTv = await display('clock');
    expect(secondTv.body.levelEndsAt).toBe(running.body.levelEndsAt);
    expect(secondTv.body.remainingMs).toBeLessThanOrEqual(
      running.body.remainingMs,
    );

    // --- pause: `remainingMs` CONGELA entre duas leituras distintas.
    await request(app.getHttpServer())
      .post(`/api/clubes/${CLUBE_ID}/torneios/${tournamentId}/clock/pause`)
      .set(asAdmin)
      .expect(201);

    const paused1 = await display('clock');
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const paused2 = await display('clock');
    expect(paused1.body.clockStatus).toBe('PAUSED');
    expect(paused1.body.levelEndsAt).toBeNull();
    expect(paused2.body.remainingMs).toBe(paused1.body.remainingMs);
    // Só o `serverTime` avança — é o que a TV usa para corrigir a deriva.
    expect(Date.parse(paused2.body.serverTime)).toBeGreaterThan(
      Date.parse(paused1.body.serverTime),
    );

    // --- resume + next: nível 2 começa inteiro (15 min).
    await request(app.getHttpServer())
      .post(`/api/clubes/${CLUBE_ID}/torneios/${tournamentId}/clock/resume`)
      .set(asAdmin)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/clubes/${CLUBE_ID}/torneios/${tournamentId}/clock/next`)
      .set(asAdmin)
      .expect(201);

    const level2 = await display('clock');
    expect(level2.body.clockStatus).toBe('RUNNING');
    expect(level2.body.currentLevel.levelNumber).toBe(2);
    expect(level2.body.nextLevel).toBeNull();
    expect(level2.body.remainingMs).toBeGreaterThan(890_000);

    // --- PATCH da duração do nível CORRENTE com o relógio RUNNING: o fim do
    // nível anda pelo DELTA (+5 min), e NÃO é recalculado como now + 20 min —
    // recalcular ressuscitaria o tempo já decorrido.
    const patchRes = await request(app.getHttpServer())
      .patch(`/api/clubes/${CLUBE_ID}/torneios/${tournamentId}/blind-levels/2`)
      .set(asAdmin)
      .send({ durationSeconds: 1200 })
      .expect(200);
    expect(Date.parse(patchRes.body.levelEndsAt)).toBe(
      Date.parse(level2.body.levelEndsAt) + 300_000,
    );

    const afterPatch = await display('clock');
    expect(Date.parse(afterPatch.body.levelEndsAt)).toBe(
      Date.parse(level2.body.levelEndsAt) + 300_000,
    );
    expect(afterPatch.body.currentLevel.durationSeconds).toBe(1200);
    // Prova de que não houve recálculo do zero: sobra menos que a duração cheia.
    expect(afterPatch.body.remainingMs).toBeLessThan(1_200_000);

    // --- previous no nível 1 é 400 (formato padrão do HttpExceptionFilter).
    await request(app.getHttpServer())
      .post(`/api/clubes/${CLUBE_ID}/torneios/${tournamentId}/clock/previous`)
      .set(asAdmin)
      .expect(201);
    const back = await request(app.getHttpServer())
      .post(`/api/clubes/${CLUBE_ID}/torneios/${tournamentId}/clock/previous`)
      .set(asAdmin)
      .expect(400);
    expect(back.body.message).toBe('O relógio já está no primeiro nível.');

    // --- Mapa de mesas público: 200 sem token e SEM dado sensível.
    const tables = await display('tables');
    expect(tables.headers['cache-control']).toBe('no-store');
    expect(tables.body).toMatchObject({
      tournamentId,
      playersRemaining: 1,
      averageStack: 5000,
    });
    expect(tables.body.tables[0].seats[0]).toEqual({
      entryId: expect.any(String),
      userName: 'Jogador Torneio',
      seatNumber: 1,
      chipStack: 5000,
    });

    // Assert sobre o JSON SERIALIZADO das duas rotas — tipo TypeScript não
    // protege ninguém em runtime.
    const serialized =
      JSON.stringify(tables.body) + JSON.stringify(level2.body);
    expect(serialized).not.toContain('userId');
    expect(serialized).not.toContain('email');
    expect(serialized).not.toContain(player.userId);

    // Torneio inexistente é 404 nas duas rotas, não 200 com corpo vazio.
    await request(app.getHttpServer())
      .get(`/api/display/tournaments/${randomUUID()}/clock`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/display/tournaments/${randomUUID()}/tables`)
      .expect(404);
  });

  it('fluxo completo: criar -> 3 inscrições -> eliminar 3º e 2º -> finish paga 1º/2º', async () => {
    const admin = await registerAndLogin(app, { admin: true });
    const playerA = await registerAndLogin(app);
    const playerB = await registerAndLogin(app);
    const playerC = await registerAndLogin(app);
    await Promise.all(
      [playerA, playerB, playerC].map((p) => creditWallet(p.userId, '500.00')),
    );

    const createRes = await request(app.getHttpServer())
      .post(`/api/clubes/${CLUBE_ID}/torneios`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({
        name: 'Sunday Major',
        buyIn: '90.00',
        fee: '10.00',
        startingStack: 10000,
        maxPlayers: 3,
        startsAt: new Date(Date.now() + 3_600_000).toISOString(),
        prizes: [
          { position: 1, percentage: '70.00' },
          { position: 2, percentage: '30.00' },
        ],
      })
      .expect(201);
    expect(createRes.body).toMatchObject({
      status: 'REGISTERING',
      registeredPlayers: 0,
    });
    const tournamentId = createRes.body.id as string;

    // Aparece no lobby.
    const lobbyRes = await request(app.getHttpServer())
      .get(`/api/clubes/${CLUBE_ID}/torneios`)
      .set('Authorization', `Bearer ${playerA.accessToken}`)
      .expect(200);
    expect(
      lobbyRes.body.items.some((t: { id: string }) => t.id === tournamentId),
    ).toBe(true);

    // 3 inscrições.
    const entryIds: Record<string, string> = {};
    for (const [label, player] of [
      ['A', playerA],
      ['B', playerB],
      ['C', playerC],
    ] as const) {
      const res = await request(app.getHttpServer())
        .post(`/api/clubes/${CLUBE_ID}/torneios/${tournamentId}/register`)
        .set('Authorization', `Bearer ${player.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .expect(201);
      expect(res.body).toMatchObject({
        status: 'REGISTERED',
        chipStack: 10000,
      });
      entryIds[label] = res.body.id as string;
    }

    // Saldo debitado (500 - 100 = 400) para os três.
    for (const player of [playerA, playerB, playerC]) {
      const balanceRes = await request(app.getHttpServer())
        .get(`/api/clubes/${CLUBE_ID}/carteira/balance`)
        .set('Authorization', `Bearer ${player.accessToken}`)
        .expect(200);
      expect(balanceRes.body.balance).toBe('400.00');
    }

    // Detalhe mostra as 3 inscrições e a grade.
    const detailRes = await request(app.getHttpServer())
      .get(`/api/clubes/${CLUBE_ID}/torneios/${tournamentId}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
    expect(detailRes.body.entries).toHaveLength(3);
    expect(detailRes.body.prizes).toEqual([
      { position: 1, percentage: '70.00' },
      { position: 2, percentage: '30.00' },
    ]);

    // PLAYER não pode eliminar.
    await request(app.getHttpServer())
      .post(
        `/api/clubes/${CLUBE_ID}/torneios/${tournamentId}/entries/${entryIds.C}/eliminate`,
      )
      .set('Authorization', `Bearer ${playerA.accessToken}`)
      .send({ finalPosition: 3 })
      .expect(403);

    // Elimina C em 3º (sem prêmio) e B em 2º — sobra A como campeão.
    await request(app.getHttpServer())
      .post(
        `/api/clubes/${CLUBE_ID}/torneios/${tournamentId}/entries/${entryIds.C}/eliminate`,
      )
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ finalPosition: 3 })
      .expect(201);

    // Torneio virou RUNNING na primeira eliminação.
    const afterFirstElimination = await request(app.getHttpServer())
      .get(`/api/clubes/${CLUBE_ID}/torneios/${tournamentId}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
    expect(afterFirstElimination.body.status).toBe('RUNNING');

    await request(app.getHttpServer())
      .post(
        `/api/clubes/${CLUBE_ID}/torneios/${tournamentId}/entries/${entryIds.B}/eliminate`,
      )
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ finalPosition: 2 })
      .expect(201);

    // Encerra: paga 70% de 270 (=189.00) para A, 30% (=81.00) para B.
    const finishRes = await request(app.getHttpServer())
      .post(`/api/clubes/${CLUBE_ID}/torneios/${tournamentId}/finish`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(201);
    expect(finishRes.body.status).toBe('FINISHED');

    const finalA = await request(app.getHttpServer())
      .get(`/api/clubes/${CLUBE_ID}/carteira/balance`)
      .set('Authorization', `Bearer ${playerA.accessToken}`)
      .expect(200);
    expect(finalA.body.balance).toBe('589.00'); // 400 + 189

    const finalB = await request(app.getHttpServer())
      .get(`/api/clubes/${CLUBE_ID}/carteira/balance`)
      .set('Authorization', `Bearer ${playerB.accessToken}`)
      .expect(200);
    expect(finalB.body.balance).toBe('481.00'); // 400 + 81

    const finalC = await request(app.getHttpServer())
      .get(`/api/clubes/${CLUBE_ID}/carteira/balance`)
      .set('Authorization', `Bearer ${playerC.accessToken}`)
      .expect(200);
    expect(finalC.body.balance).toBe('400.00'); // sem prêmio (3º lugar)

    const finalDetail = await request(app.getHttpServer())
      .get(`/api/clubes/${CLUBE_ID}/torneios/${tournamentId}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
    const byId = Object.fromEntries(
      (finalDetail.body.entries as Array<{ id: string }>).map((e) => [e.id, e]),
    );
    expect(byId[entryIds.A]).toMatchObject({
      status: 'PAID',
      finalPosition: 1,
      prizeAmount: '189.00',
    });
    expect(byId[entryIds.B]).toMatchObject({
      status: 'PAID',
      finalPosition: 2,
      prizeAmount: '81.00',
    });
    expect(byId[entryIds.C]).toMatchObject({
      status: 'ELIMINATED',
      finalPosition: 3,
      prizeAmount: null,
    });

    // Reexecutar finish num torneio já FINISHED é rejeitado (não paga de novo).
    await request(app.getHttpServer())
      .post(`/api/clubes/${CLUBE_ID}/torneios/${tournamentId}/finish`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(400);
  });

  it('bônus de staff: opt-in debita mais e credita fichas extras; sem optar, fica no buy-in normal', async () => {
    const admin = await registerAndLogin(app, { admin: true });
    const withBonus = await registerAndLogin(app);
    const withoutBonus = await registerAndLogin(app);
    await Promise.all(
      [withBonus, withoutBonus].map((p) => creditWallet(p.userId, '200.00')),
    );

    const createRes = await request(app.getHttpServer())
      .post(`/api/clubes/${CLUBE_ID}/torneios`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({
        name: 'Staff Bonus Open',
        buyIn: '90.00',
        fee: '10.00',
        staffBonusCost: '5.00',
        staffBonusChips: 2500,
        startingStack: 10000,
        maxPlayers: 4,
        startsAt: new Date(Date.now() + 3_600_000).toISOString(),
        prizes: [{ position: 1, percentage: '100.00' }],
      })
      .expect(201);
    expect(createRes.body).toMatchObject({
      staffBonusCost: '5.00',
      staffBonusChips: 2500,
    });
    const tournamentId = createRes.body.id as string;

    const bonusEntryRes = await request(app.getHttpServer())
      .post(`/api/clubes/${CLUBE_ID}/torneios/${tournamentId}/register`)
      .set('Authorization', `Bearer ${withBonus.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ staffBonus: true })
      .expect(201);
    expect(bonusEntryRes.body).toMatchObject({
      chipStack: 12500, // 10000 + 2500
      staffBonusPaid: true,
    });

    const plainEntryRes = await request(app.getHttpServer())
      .post(`/api/clubes/${CLUBE_ID}/torneios/${tournamentId}/register`)
      .set('Authorization', `Bearer ${withoutBonus.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    expect(plainEntryRes.body).toMatchObject({
      chipStack: 10000,
      staffBonusPaid: false,
    });

    // 200 - (90 + 10 + 5) = 95 para quem pagou o bônus; 200 - 100 = 100 para quem não pagou.
    const bonusBalance = await request(app.getHttpServer())
      .get(`/api/clubes/${CLUBE_ID}/carteira/balance`)
      .set('Authorization', `Bearer ${withBonus.accessToken}`)
      .expect(200);
    expect(bonusBalance.body.balance).toBe('95.00');

    const plainBalance = await request(app.getHttpServer())
      .get(`/api/clubes/${CLUBE_ID}/carteira/balance`)
      .set('Authorization', `Bearer ${withoutBonus.accessToken}`)
      .expect(200);
    expect(plainBalance.body.balance).toBe('100.00');

    // O prize pool só viu os dois buy-ins (90 x 2) — o bônus de staff nunca entra nele.
    const detailRes = await request(app.getHttpServer())
      .get(`/api/clubes/${CLUBE_ID}/torneios/${tournamentId}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
    expect(detailRes.body.entries).toHaveLength(2);

    // Torneio sem bônus configurado recusa staffBonus: true.
    const noBonusCreateRes = await request(app.getHttpServer())
      .post(`/api/clubes/${CLUBE_ID}/torneios`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({
        name: 'Sem Bônus',
        buyIn: '10.00',
        fee: '1.00',
        startingStack: 1000,
        maxPlayers: 2,
        startsAt: new Date(Date.now() + 3_600_000).toISOString(),
        prizes: [{ position: 1, percentage: '100.00' }],
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(
        `/api/clubes/${CLUBE_ID}/torneios/${noBonusCreateRes.body.id}/register`,
      )
      .set('Authorization', `Bearer ${withBonus.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ staffBonus: true })
      .expect(400);
  });

  it('editar torneio: funciona antes da 1ª inscrição, trava depois', async () => {
    const admin = await registerAndLogin(app, { admin: true });
    const player = await registerAndLogin(app);
    await creditWallet(player.userId, '200.00');

    const createRes = await request(app.getHttpServer())
      .post(`/api/clubes/${CLUBE_ID}/torneios`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({
        name: 'Rascunho',
        buyIn: '50.00',
        fee: '5.00',
        startingStack: 5000,
        maxPlayers: 9,
        startsAt: new Date(Date.now() + 3_600_000).toISOString(),
        prizes: [{ position: 1, percentage: '100.00' }],
      })
      .expect(201);
    const tournamentId = createRes.body.id as string;

    // PLAYER não pode editar.
    await request(app.getHttpServer())
      .patch(`/api/clubes/${CLUBE_ID}/torneios/${tournamentId}`)
      .set('Authorization', `Bearer ${player.accessToken}`)
      .send({ name: 'Hackeado' })
      .expect(403);

    // ADMIN edita nome, buy-in e a grade de premiação inteira.
    await request(app.getHttpServer())
      .patch(`/api/clubes/${CLUBE_ID}/torneios/${tournamentId}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({
        name: 'Sunday Major (editado)',
        buyIn: '90.00',
        prizes: [
          { position: 1, percentage: '70.00' },
          { position: 2, percentage: '30.00' },
        ],
      })
      .expect(200)
      .expect((res) => {
        if (res.body.name !== 'Sunday Major (editado)')
          throw new Error('nome não mudou');
        if (res.body.buyIn !== '90.00') throw new Error('buyIn não mudou');
      });

    const detailRes = await request(app.getHttpServer())
      .get(`/api/clubes/${CLUBE_ID}/torneios/${tournamentId}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
    expect(detailRes.body.prizes).toEqual([
      { position: 1, percentage: '70.00' },
      { position: 2, percentage: '30.00' },
    ]);
    // Campos que só existem no detalhe (não na listagem) também vieram.
    expect(detailRes.body).toMatchObject({
      startingStack: 5000,
      tableCapacity: 9,
      allowReentry: false,
    });

    // Primeira inscrição — a partir daqui a configuração trava.
    await request(app.getHttpServer())
      .post(`/api/clubes/${CLUBE_ID}/torneios/${tournamentId}/register`)
      .set('Authorization', `Bearer ${player.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/clubes/${CLUBE_ID}/torneios/${tournamentId}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ name: 'Tarde demais' })
      .expect(400);
  });

  // Bug relatado: cancelamento (REFUNDED) continuava contando em
  // `registeredPlayers` e travando a edição, como se a inscrição seguisse
  // valendo.
  it('cancelamento (REFUNDED) não conta em registeredPlayers e libera edição de novo', async () => {
    const admin = await registerAndLogin(app, { admin: true });
    const playerA = await registerAndLogin(app);
    const playerB = await registerAndLogin(app);
    await Promise.all(
      [playerA, playerB].map((p) => creditWallet(p.userId, '200.00')),
    );

    const createRes = await request(app.getHttpServer())
      .post(`/api/clubes/${CLUBE_ID}/torneios`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({
        name: 'Cancela Tudo',
        buyIn: '50.00',
        fee: '5.00',
        startingStack: 5000,
        maxPlayers: 9,
        startsAt: new Date(Date.now() + 3_600_000).toISOString(),
        prizes: [{ position: 1, percentage: '100.00' }],
      })
      .expect(201);
    const tournamentId = createRes.body.id as string;

    for (const player of [playerA, playerB]) {
      await request(app.getHttpServer())
        .post(`/api/clubes/${CLUBE_ID}/torneios/${tournamentId}/register`)
        .set('Authorization', `Bearer ${player.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .expect(201);
    }

    const afterRegister = await request(app.getHttpServer())
      .get(`/api/clubes/${CLUBE_ID}/torneios/${tournamentId}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
    expect(afterRegister.body.registeredPlayers).toBe(2);

    // Os dois cancelam.
    for (const player of [playerA, playerB]) {
      await request(app.getHttpServer())
        .post(`/api/clubes/${CLUBE_ID}/torneios/${tournamentId}/unregister`)
        .set('Authorization', `Bearer ${player.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .expect(201);
    }

    // Contagem não inclui os cancelados — nem no detalhe, nem no lobby —
    // mas eles continuam na lista de inscritos, como REFUNDED (trilha).
    const afterCancel = await request(app.getHttpServer())
      .get(`/api/clubes/${CLUBE_ID}/torneios/${tournamentId}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
    expect(afterCancel.body.registeredPlayers).toBe(0);
    expect(afterCancel.body.entries).toHaveLength(2);
    expect(
      afterCancel.body.entries.every(
        (e: { status: string }) => e.status === 'REFUNDED',
      ),
    ).toBe(true);

    const lobbyRes = await request(app.getHttpServer())
      .get(`/api/clubes/${CLUBE_ID}/torneios`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
    const lobbyEntry = lobbyRes.body.items.find(
      (t: { id: string }) => t.id === tournamentId,
    );
    expect(lobbyEntry.registeredPlayers).toBe(0);

    // Ninguém "de verdade" inscrito: a configuração volta a ser editável.
    await request(app.getHttpServer())
      .patch(`/api/clubes/${CLUBE_ID}/torneios/${tournamentId}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ name: 'Reaberto pra edição' })
      .expect(200);

    // Saldos voltaram (buyIn+fee devolvidos a cada um).
    for (const player of [playerA, playerB]) {
      const balanceRes = await request(app.getHttpServer())
        .get(`/api/clubes/${CLUBE_ID}/carteira/balance`)
        .set('Authorization', `Bearer ${player.accessToken}`)
        .expect(200);
      expect(balanceRes.body.balance).toBe('200.00');
    }
  });
});
