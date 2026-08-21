import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { AbacatePayClient } from './../src/integrations/abacatepay';

/**
 * Não há endpoint de "promover a ADMIN" no MVP (fora de escopo) — o teste
 * eleva o papel direto no banco, como já faz `schema-invariants.int-spec.ts`.
 */
const prismaDirect = new PrismaClient();

async function registerAndLogin(
  app: INestApplication<App>,
  opts: { admin?: boolean } = {},
): Promise<{ accessToken: string; userId: string }> {
  const email = `${randomUUID()}@table-e2e.test`;
  const registerRes = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({ email, password: 'senha-forte-123', name: 'Jogador Mesa' })
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

describe('Tables (e2e)', () => {
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

  it('PLAYER não pode criar mesa (403)', async () => {
    const { accessToken } = await registerAndLogin(app);

    await request(app.getHttpServer())
      .post('/api/tables')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Mesa proibida',
        type: 'CASH_GAME',
        smallBlind: '1.00',
        bigBlind: '2.00',
        minBuyIn: '40.00',
        maxBuyIn: '200.00',
        maxSeats: 6,
      })
      .expect(403);
  });

  it('fluxo completo: ADMIN cria mesa -> PLAYER senta (buy-in) -> ADMIN registra resultado -> PLAYER cash-out', async () => {
    const admin = await registerAndLogin(app, { admin: true });
    const player = await registerAndLogin(app);
    await creditWallet(player.userId, '500.00');

    const createRes = await request(app.getHttpServer())
      .post('/api/tables')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({
        name: 'NL Holdem 1/2',
        type: 'CASH_GAME',
        smallBlind: '1.00',
        bigBlind: '2.00',
        minBuyIn: '40.00',
        maxBuyIn: '200.00',
        maxSeats: 6,
      })
      .expect(201);
    expect(createRes.body).toMatchObject({ occupiedSeats: 0, status: 'OPEN' });
    const tableId = createRes.body.id as string;

    // Mesa aparece no lobby.
    const lobbyRes = await request(app.getHttpServer())
      .get('/api/tables')
      .set('Authorization', `Bearer ${player.accessToken}`)
      .expect(200);
    expect(
      lobbyRes.body.items.some((t: { id: string }) => t.id === tableId),
    ).toBe(true);

    // Assentos vazios inicialmente.
    const emptySeats = await request(app.getHttpServer())
      .get(`/api/tables/${tableId}/seats`)
      .set('Authorization', `Bearer ${player.accessToken}`)
      .expect(200);
    expect(emptySeats.body).toHaveLength(6);
    expect(
      emptySeats.body.every((s: { userId: null }) => s.userId === null),
    ).toBe(true);

    // PLAYER senta com buy-in de 100.
    const sitRes = await request(app.getHttpServer())
      .post(`/api/tables/${tableId}/sit`)
      .set('Authorization', `Bearer ${player.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ seatNumber: 2, buyInAmount: '100.00' })
      .expect(201);
    expect(sitRes.body).toMatchObject({
      seatNumber: 2,
      currentStack: '100.00',
    });

    // Saldo da wallet foi debitado.
    const balanceAfterSit = await request(app.getHttpServer())
      .get('/api/wallet/balance')
      .set('Authorization', `Bearer ${player.accessToken}`)
      .expect(200);
    expect(balanceAfterSit.body.balance).toBe('400.00');

    // Sentar de novo no mesmo assento é rejeitado (índice único parcial).
    const other = await registerAndLogin(app);
    await creditWallet(other.userId, '500.00');
    await request(app.getHttpServer())
      .post(`/api/tables/${tableId}/sit`)
      .set('Authorization', `Bearer ${other.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ seatNumber: 2, buyInAmount: '100.00' })
      .expect(409);

    // Descobre o id da sessão via /seats (não é devolvido em outro lugar).
    const seatsRes = await request(app.getHttpServer())
      .get(`/api/tables/${tableId}/seats`)
      .set('Authorization', `Bearer ${player.accessToken}`)
      .expect(200);
    expect(seatsRes.body[1]).toMatchObject({
      seatNumber: 2,
      currentStack: '100.00',
    });

    const session = await prismaDirect.tableSession.findFirstOrThrow({
      where: { tableId, userId: player.userId, status: 'ACTIVE' },
    });

    // PLAYER não pode registrar resultado de mão (só ADMIN).
    await request(app.getHttpServer())
      .post(`/api/tables/${tableId}/sessions/${session.id}/movements`)
      .set('Authorization', `Bearer ${player.accessToken}`)
      .send({ amount: '50.00', reason: 'HAND_RESULT' })
      .expect(403);

    // ADMIN registra uma mão ganha de +50.
    const movementRes = await request(app.getHttpServer())
      .post(`/api/tables/${tableId}/sessions/${session.id}/movements`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ amount: '50.00', reason: 'HAND_RESULT' })
      .expect(201);
    expect(movementRes.body.currentStack).toBe('150.00');

    // PLAYER faz cash-out do stack inteiro (150).
    const cashOutRes = await request(app.getHttpServer())
      .post(`/api/tables/${tableId}/sessions/${session.id}/cash-out`)
      .set('Authorization', `Bearer ${player.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    expect(cashOutRes.body).toEqual({
      seatNumber: 2,
      userId: null,
      userName: null,
      currentStack: null,
      sessionId: null,
    });

    // Saldo final: 400 (após buy-in) + 150 (cash-out) = 550.
    const finalBalance = await request(app.getHttpServer())
      .get('/api/wallet/balance')
      .set('Authorization', `Bearer ${player.accessToken}`)
      .expect(200);
    expect(finalBalance.body.balance).toBe('550.00');

    // Assento voltou a ficar livre — outro jogador pode sentar nele.
    const finalSeats = await request(app.getHttpServer())
      .get(`/api/tables/${tableId}/seats`)
      .set('Authorization', `Bearer ${player.accessToken}`)
      .expect(200);
    expect(finalSeats.body[1]).toMatchObject({ seatNumber: 2, userId: null });
  });
});
