import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { createHmac, randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { AbacatePayClient } from './../src/integrations/abacatepay';

/**
 * Cliente AbacatePay em modo fake: o teste nunca sai para a rede. Só os
 * métodos usados pelo `WalletService` precisam existir.
 */
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

describe('Wallet + webhook AbacatePay (e2e)', () => {
  let app: INestApplication<App>;
  let accessToken: string;

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

    const email = `${randomUUID()}@wallet-e2e.test`;
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password: 'senha-forte-123', name: 'Wallet E2E' })
      .expect(201);
    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: 'senha-forte-123' })
      .expect(200);
    accessToken = loginRes.body.accessToken as string;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  const authed = () =>
    request(app.getHttpServer())
      .get('/api/wallet/balance')
      .set('Authorization', `Bearer ${accessToken}`);

  it('sem token, /wallet/balance responde 401', async () => {
    await request(app.getHttpServer()).get('/api/wallet/balance').expect(401);
  });

  it('começa com saldo 0.00', async () => {
    const res = await authed().expect(200);
    expect(res.body).toEqual({ balance: '0.00', version: 0 });
  });

  it('POST /wallet/deposits sem Idempotency-Key retorna 400', async () => {
    await request(app.getHttpServer())
      .post('/api/wallet/deposits')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ amount: '50.00' })
      .expect(400);
  });

  it('fluxo completo: depósito -> webhook credita -> saque debita', async () => {
    const chargeExternalId = `chg-${randomUUID()}`;
    fakeAbacatePayClient.createPixCharge.mockResolvedValue({
      externalId: chargeExternalId,
      status: 'PENDING',
      rawStatus: 'PENDING',
      amount: '100.00',
      brCode: '000201...copia-e-cola...',
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      createdAt: new Date().toISOString(),
    });

    const depositRes = await request(app.getHttpServer())
      .post('/api/wallet/deposits')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ amount: '100.00' })
      .expect(201);
    expect(depositRes.body).toMatchObject({
      amount: '100.00',
      status: 'PENDING',
    });

    // Saldo ainda não muda: só o webhook confirma o pagamento.
    const beforeWebhook = await authed().expect(200);
    expect(beforeWebhook.body.balance).toBe('0.00');

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

    const afterWebhook = await authed().expect(200);
    expect(afterWebhook.body).toEqual({ balance: '100.00', version: 1 });

    // Reenviar o MESMO webhook (replay do provedor) não credita de novo.
    await request(app.getHttpServer())
      .post('/api/webhooks/abacatepay')
      .set('Content-Type', 'application/json')
      .set('x-abacatepay-signature', signWebhook(webhookBody, timestamp))
      .set('x-abacatepay-timestamp', timestamp)
      .send(webhookBody)
      .expect(204);
    const afterReplay = await authed().expect(200);
    expect(afterReplay.body).toEqual({ balance: '100.00', version: 1 });

    // Extrato mostra o depósito.
    const statement = await request(app.getHttpServer())
      .get('/api/wallet/transactions')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(statement.body.items).toHaveLength(1);
    expect(statement.body.items[0]).toMatchObject({
      type: 'PIX_DEPOSIT',
      amount: '100.00',
    });

    // Saque debita o saldo.
    fakeAbacatePayClient.requestPixWithdrawal.mockResolvedValue({
      externalId: `wdr-${randomUUID()}`,
      status: 'PENDING',
      rawStatus: 'PENDING',
      amount: '30.00',
      createdAt: new Date().toISOString(),
    });
    const withdrawalRes = await request(app.getHttpServer())
      .post('/api/wallet/withdrawals')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ amount: '30.00', pixKey: 'jogador@pix.dev', pixKeyType: 'EMAIL' })
      .expect(201);
    expect(withdrawalRes.body).toMatchObject({
      amount: '30.00',
      status: 'PROCESSING',
    });
    expect(withdrawalRes.body.pixKeyMasked).toBe('***.dev');

    const afterWithdrawal = await authed().expect(200);
    expect(afterWithdrawal.body).toEqual({ balance: '70.00', version: 2 });
  });

  it('webhook com assinatura inválida é rejeitado (401) e não altera saldo', async () => {
    const body = JSON.stringify({
      id: 'evt-x',
      event: 'billing.paid',
      data: { id: 'chg-x' },
    });
    const timestamp = String(Math.floor(Date.now() / 1000));

    await request(app.getHttpServer())
      .post('/api/webhooks/abacatepay')
      .set('Content-Type', 'application/json')
      .set('x-abacatepay-signature', 'assinatura-forjada')
      .set('x-abacatepay-timestamp', timestamp)
      .send(body)
      .expect(401);
  });
});
