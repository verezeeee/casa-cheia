import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { AbacatePayClient } from './../src/integrations/abacatepay';

const prismaDirect = new PrismaClient();

async function registerAndLogin(
  app: INestApplication<App>,
  opts: { admin?: boolean } = {},
): Promise<{ accessToken: string; userId: string }> {
  const email = `${randomUUID()}@tournament-e2e.test`;
  const registerRes = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({ email, password: 'senha-forte-123', name: 'Jogador Torneio' })
    .expect(201);

  if (opts.admin) {
    await prismaDirect.user.update({
      where: { id: registerRes.body.id },
      data: { role: 'ADMIN' },
    });
  }

  const loginRes = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password: 'senha-forte-123' })
    .expect(200);

  return {
    accessToken: loginRes.body.accessToken as string,
    userId: registerRes.body.id as string,
  };
}

async function creditWallet(userId: string, amount: string): Promise<void> {
  const wallet = await prismaDirect.wallet.findUniqueOrThrow({
    where: { userId },
  });
  await prismaDirect.$transaction([
    prismaDirect.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: 'ADJUSTMENT',
        status: 'COMPLETED',
        amount,
        balanceAfter: amount,
        idempotencyKey: `test-credit:${randomUUID()}`,
        description: 'Crédito de teste (fixture e2e)',
      },
    }),
    prismaDirect.wallet.update({
      where: { id: wallet.id },
      data: { balance: amount },
    }),
  ]);
}

describe('Tournaments (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AbacatePayClient)
      .useValue({ createPixCharge: jest.fn(), requestPixWithdrawal: jest.fn() })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await prismaDirect.$disconnect();
  });

  it('PLAYER não pode criar torneio (403)', async () => {
    const { accessToken } = await registerAndLogin(app);
    await request(app.getHttpServer())
      .post('/api/tournaments')
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
      .post('/api/tournaments')
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

  it('fluxo completo: criar -> 3 inscrições -> eliminar 3º e 2º -> finish paga 1º/2º', async () => {
    const admin = await registerAndLogin(app, { admin: true });
    const playerA = await registerAndLogin(app);
    const playerB = await registerAndLogin(app);
    const playerC = await registerAndLogin(app);
    await Promise.all(
      [playerA, playerB, playerC].map((p) => creditWallet(p.userId, '500.00')),
    );

    const createRes = await request(app.getHttpServer())
      .post('/api/tournaments')
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
      .get('/api/tournaments')
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
        .post(`/api/tournaments/${tournamentId}/register`)
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
        .get('/api/wallet/balance')
        .set('Authorization', `Bearer ${player.accessToken}`)
        .expect(200);
      expect(balanceRes.body.balance).toBe('400.00');
    }

    // Detalhe mostra as 3 inscrições e a grade.
    const detailRes = await request(app.getHttpServer())
      .get(`/api/tournaments/${tournamentId}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
    expect(detailRes.body.entries).toHaveLength(3);
    expect(detailRes.body.prizes).toEqual([
      { position: 1, percentage: '70.00' },
      { position: 2, percentage: '30.00' },
    ]);

    // PLAYER não pode eliminar.
    await request(app.getHttpServer())
      .post(`/api/tournaments/${tournamentId}/entries/${entryIds.C}/eliminate`)
      .set('Authorization', `Bearer ${playerA.accessToken}`)
      .send({ finalPosition: 3 })
      .expect(403);

    // Elimina C em 3º (sem prêmio) e B em 2º — sobra A como campeão.
    await request(app.getHttpServer())
      .post(`/api/tournaments/${tournamentId}/entries/${entryIds.C}/eliminate`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ finalPosition: 3 })
      .expect(201);

    // Torneio virou RUNNING na primeira eliminação.
    const afterFirstElimination = await request(app.getHttpServer())
      .get(`/api/tournaments/${tournamentId}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
    expect(afterFirstElimination.body.status).toBe('RUNNING');

    await request(app.getHttpServer())
      .post(`/api/tournaments/${tournamentId}/entries/${entryIds.B}/eliminate`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ finalPosition: 2 })
      .expect(201);

    // Encerra: paga 70% de 270 (=189.00) para A, 30% (=81.00) para B.
    const finishRes = await request(app.getHttpServer())
      .post(`/api/tournaments/${tournamentId}/finish`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(201);
    expect(finishRes.body.status).toBe('FINISHED');

    const finalA = await request(app.getHttpServer())
      .get('/api/wallet/balance')
      .set('Authorization', `Bearer ${playerA.accessToken}`)
      .expect(200);
    expect(finalA.body.balance).toBe('589.00'); // 400 + 189

    const finalB = await request(app.getHttpServer())
      .get('/api/wallet/balance')
      .set('Authorization', `Bearer ${playerB.accessToken}`)
      .expect(200);
    expect(finalB.body.balance).toBe('481.00'); // 400 + 81

    const finalC = await request(app.getHttpServer())
      .get('/api/wallet/balance')
      .set('Authorization', `Bearer ${playerC.accessToken}`)
      .expect(200);
    expect(finalC.body.balance).toBe('400.00'); // sem prêmio (3º lugar)

    const finalDetail = await request(app.getHttpServer())
      .get(`/api/tournaments/${tournamentId}`)
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
      .post(`/api/tournaments/${tournamentId}/finish`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(400);
  });
});
