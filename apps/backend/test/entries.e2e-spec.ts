import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  bootstrapTestApp,
  createTestClube,
  creditWallet,
  prismaDirect,
  registerAndLogin,
} from './tournament-helpers';

/**
 * Histórico unificado de entradas (torneio + mesa): ADMIN vê o clube
 * inteiro, PLAYER só as próprias — ver `EntriesController`/`EntriesService`.
 */
describe('Entradas — histórico de torneio + mesa (e2e)', () => {
  let app: INestApplication<App>;
  let clubeId: string;

  beforeAll(async () => {
    app = await bootstrapTestApp();
    clubeId = await createTestClube('Clube Entradas');
  });

  afterAll(async () => {
    await app.close();
    await prismaDirect.$disconnect();
  });

  it('PLAYER vê só as próprias entradas (torneio + mesa); ADMIN vê de todo mundo', async () => {
    const admin = await registerAndLogin(app, { admin: true });
    const player1 = await registerAndLogin(app);
    const player2 = await registerAndLogin(app);
    await creditWallet(player1.userId, '1000.00');
    await creditWallet(player2.userId, '1000.00');

    const tableRes = await request(app.getHttpServer())
      .post(`/api/clubes/${clubeId}/mesas`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({
        name: 'Mesa Entradas',
        type: 'CASH_GAME',
        smallBlind: '1.00',
        bigBlind: '2.00',
        minBuyIn: '40.00',
        maxBuyIn: '200.00',
        maxSeats: 6,
      })
      .expect(201);
    const tableId = tableRes.body.id as string;

    await request(app.getHttpServer())
      .post(`/api/clubes/${clubeId}/mesas/${tableId}/sit`)
      .set('Authorization', `Bearer ${player1.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ seatNumber: 1, buyInAmount: '100.00' })
      .expect(201);

    const tournamentRes = await request(app.getHttpServer())
      .post(`/api/clubes/${clubeId}/torneios`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({
        name: 'Torneio Entradas',
        buyIn: '90.00',
        fee: '10.00',
        startingStack: 10_000,
        maxPlayers: 9,
        startsAt: new Date(Date.now() + 3_600_000).toISOString(),
        prizes: [{ position: 1, percentage: '100.00' }],
      })
      .expect(201);
    const tournamentId = tournamentRes.body.id as string;

    // Só player1 entra na mesa; player1 E player2 se inscrevem no torneio.
    await request(app.getHttpServer())
      .post(`/api/clubes/${clubeId}/torneios/${tournamentId}/register`)
      .set('Authorization', `Bearer ${player1.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/clubes/${clubeId}/torneios/${tournamentId}/register`)
      .set('Authorization', `Bearer ${player2.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .expect(201);

    // player1: 2 entradas (mesa + torneio), nada de player2.
    const player1Res = await request(app.getHttpServer())
      .get(`/api/clubes/${clubeId}/entradas`)
      .set('Authorization', `Bearer ${player1.accessToken}`)
      .expect(200);
    expect(player1Res.body.items).toHaveLength(2);
    expect(
      (player1Res.body.items as Array<{ kind: string }>)
        .map((i) => i.kind)
        .sort(),
    ).toEqual(['TABLE', 'TOURNAMENT']);
    expect(
      (player1Res.body.items as Array<{ userId: string }>).every(
        (i) => i.userId === player1.userId,
      ),
    ).toBe(true);

    // player2: só a própria inscrição de torneio.
    const player2Res = await request(app.getHttpServer())
      .get(`/api/clubes/${clubeId}/entradas`)
      .set('Authorization', `Bearer ${player2.accessToken}`)
      .expect(200);
    expect(player2Res.body.items).toHaveLength(1);
    expect(player2Res.body.items[0]).toMatchObject({
      kind: 'TOURNAMENT',
      userId: player2.userId,
    });

    // admin: as 3 entradas do clube (mesa de player1 + torneio de ambos).
    const adminRes = await request(app.getHttpServer())
      .get(`/api/clubes/${clubeId}/entradas`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
    expect(adminRes.body.items).toHaveLength(3);
    const adminUserIds = (adminRes.body.items as Array<{ userId: string }>).map(
      (i) => i.userId,
    );
    expect(adminUserIds.filter((id) => id === player1.userId)).toHaveLength(2);
    expect(adminUserIds.filter((id) => id === player2.userId)).toHaveLength(1);
  });
});
