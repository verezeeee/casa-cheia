import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import cookieParser from 'cookie-parser';
import { createHmac, randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { AbacatePayClient } from './../src/integrations/abacatepay';

/**
 * Fumaça ponta a ponta do MVP: um jogador percorre o ciclo completo de
 * dinheiro (registrar → login → depositar via PIX → sentar numa mesa com
 * buy-in → cash-out → sacar) contra um Postgres real. Cada etapa já tem
 * cobertura fina em `wallet.e2e-spec.ts`/`table.e2e-spec.ts`; este teste
 * garante que as etapas se encaixam como um fluxo único, sem reencanar
 * sessão/saldo entre módulos.
 */
const prismaDirect = new PrismaClient();

const fakeAbacatePayClient = {
  createPixCharge: jest.fn(),
  requestPixWithdrawal: jest.fn(),
};

function signWebhook(body: string, timestamp: string): string {
  const secret = process.env.ABACATEPAY_WEBHOOK_SECRET ?? '';
  return createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');
}

describe('Fumaça: registrar -> depositar -> sentar -> cash-out -> sacar (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AbacatePayClient)
      .useValue(fakeAbacatePayClient)
      .compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
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

  it('percorre o ciclo completo de dinheiro de um jogador', async () => {
    // 1. Registro + login.
    const email = `${randomUUID()}@smoke-e2e.test`;
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password: 'senha-forte-123', name: 'Jogador Fumaça' })
      .expect(201);

    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: 'senha-forte-123' })
      .expect(200);
    const accessToken = loginRes.body.accessToken as string;

    const balance = () =>
      request(app.getHttpServer())
        .get('/api/wallet/balance')
        .set('Authorization', `Bearer ${accessToken}`);
    expect((await balance().expect(200)).body.balance).toBe('0.00');

    // 2. Depósito PIX confirmado via webhook.
    const chargeExternalId = `chg-${randomUUID()}`;
    fakeAbacatePayClient.createPixCharge.mockResolvedValue({
      externalId: chargeExternalId,
      status: 'PENDING',
      rawStatus: 'PENDING',
      amount: '300.00',
      brCode: '000201...copia-e-cola...',
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      createdAt: new Date().toISOString(),
    });
    await request(app.getHttpServer())
      .post('/api/wallet/deposits')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ amount: '300.00' })
      .expect(201);

    const webhookBody = JSON.stringify({
      id: `evt-${randomUUID()}`,
      event: 'billing.paid',
      data: { id: chargeExternalId },
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    await request(app.getHttpServer())
      .post('/api/webhooks/abacatepay')
      .set('Content-Type', 'application/json')
      .set('x-abacatepay-signature', signWebhook(webhookBody, timestamp))
      .set('x-abacatepay-timestamp', timestamp)
      .send(webhookBody)
      .expect(204);
    expect((await balance().expect(200)).body.balance).toBe('300.00');

    // 3. Uma mesa precisa existir — criada por um segundo usuário promovido a
    // ADMIN direto no banco (não há endpoint de promoção no MVP).
    const adminEmail = `${randomUUID()}@smoke-e2e.test`;
    const adminRegisterRes = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email: adminEmail,
        password: 'senha-forte-123',
        name: 'Admin Fumaça',
      })
      .expect(201);
    await prismaDirect.user.update({
      where: { id: adminRegisterRes.body.id as string },
      data: { role: 'ADMIN' },
    });
    const adminLoginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: adminEmail, password: 'senha-forte-123' })
      .expect(200);
    const adminAccessToken = adminLoginRes.body.accessToken as string;

    const tableRes = await request(app.getHttpServer())
      .post('/api/tables')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        name: 'Mesa Fumaça',
        type: 'CASH_GAME',
        smallBlind: '1.00',
        bigBlind: '2.00',
        minBuyIn: '40.00',
        maxBuyIn: '200.00',
        maxSeats: 6,
      })
      .expect(201);
    const tableId = tableRes.body.id as string;

    // 4. Senta com buy-in de 100.00 — debita a wallet.
    const sitRes = await request(app.getHttpServer())
      .post(`/api/tables/${tableId}/sit`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ seatNumber: 1, buyInAmount: '100.00' })
      .expect(201);
    const sessionId = sitRes.body.sessionId as string;
    expect((await balance().expect(200)).body.balance).toBe('200.00');

    // 5. Cash-out — credita o stack de volta na wallet.
    await request(app.getHttpServer())
      .post(`/api/tables/${tableId}/sessions/${sessionId}/cash-out`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    expect((await balance().expect(200)).body.balance).toBe('300.00');

    // 6. Saque PIX — debita a wallet.
    fakeAbacatePayClient.requestPixWithdrawal.mockResolvedValue({
      externalId: `wdr-${randomUUID()}`,
      status: 'PENDING',
      rawStatus: 'PENDING',
      amount: '150.00',
      createdAt: new Date().toISOString(),
    });
    await request(app.getHttpServer())
      .post('/api/wallet/withdrawals')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        amount: '150.00',
        pixKey: 'jogador@pix.dev',
        pixKeyType: 'EMAIL',
      })
      .expect(201);
    expect((await balance().expect(200)).body.balance).toBe('150.00');
  });
});
