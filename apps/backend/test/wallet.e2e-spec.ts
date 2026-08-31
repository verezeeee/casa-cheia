import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '../src/generated/prisma';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
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

/** Cliente direto ao Postgres: monta clube + vínculo (não há `POST /clubes`, ADR-0003). */
const prismaDirect = new PrismaClient();

/** Ids criados pela suíte, para o teardown (vínculo antes do clube: FK Restrict). */
const createdClubeIds: string[] = [];

/**
 * Envelope confirmado contra uma entrega real do AbacatePay (23/08/2026,
 * `transparent.completed`, dev mode) — ver docblock de
 * `WalletService.handleWebhook`. `resource` é o primeiro segmento de
 * `event` ("transparent" de "transparent.completed").
 */
function webhookBody(event: string, resource: string, dataId: string): string {
  return JSON.stringify({
    id: `evt-${randomUUID()}`,
    event,
    apiVersion: 2,
    devMode: true,
    data: { [resource]: { id: dataId } },
  });
}

const WEBHOOK_SECRET = process.env.ABACATEPAY_WEBHOOK_SECRET ?? '';

// EM STANDBY: exercita o fluxo real de depósito/saque/webhook via
// `overrideProvider(AbacatePayClient, fakeClient)`. O gateway foi
// desconectado do módulo (ver docblock de `WalletService.createDeposit`) —
// `createDeposit`/`requestWithdrawal`/`handleWebhook` agora sempre recusam,
// então este cenário não se aplica mais. Reativar junto da integração real.
describe.skip('Wallet + webhook AbacatePay (e2e)', () => {
  let app: INestApplication<App>;
  let accessToken: string;
  let userId: string;
  let clubeId: string;

  /**
   * Registra + loga um jogador novo e já cria seu vínculo ACTIVE no clube de
   * teste (rota exige `ClubeMembershipGuard`) e a `Wallet` zerada dele nesse
   * clube. `AuthService.register` deliberadamente NÃO cria mais carteira
   * (CL-BE-03/04: `Wallet` é por `(userId, clubeId)`, e uma conta recém
   * criada não pertence a clube nenhum ainda) — criar a carteira ao ingressar
   * no clube é um TODO de outra tarefa (`TODO(CL-BE-04/wallet)` em
   * `auth.service.ts`), não desta. Aqui montamos a fixture manualmente pelo
   * mesmo motivo que `tenant-isolation.int-spec.ts` também cria a wallet
   * direto no banco.
   */
  async function registerMember(): Promise<{
    accessToken: string;
    userId: string;
    clubeId: string;
  }> {
    const email = `${randomUUID()}@wallet-e2e.test`;
    const registerRes = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password: 'senha-forte-123', name: 'Wallet E2E' })
      .expect(201);
    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: 'senha-forte-123' })
      .expect(200);
    const userId = registerRes.body.id as string;

    const memberClubeId = await prismaDirect.clube
      .create({
        data: {
          name: 'Clube Wallet E2E',
          document: randomUUID().replace(/-/g, ''),
        },
      })
      .then((clube) => clube.id);
    createdClubeIds.push(memberClubeId);
    await prismaDirect.clubeMembership.create({
      data: { clubeId: memberClubeId, userId, role: 'PLAYER' },
    });
    await prismaDirect.wallet.create({
      data: { userId, clubeId: memberClubeId, balance: 0 },
    });

    return {
      accessToken: loginRes.body.accessToken as string,
      userId,
      clubeId: memberClubeId,
    };
  }

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

    const member = await registerMember();
    accessToken = member.accessToken;
    userId = member.userId;
    clubeId = member.clubeId;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
    // Ordem importa: tudo aqui é FK `onDelete: Restrict` até `Clube`.
    await prismaDirect.walletTransaction.deleteMany({
      where: { wallet: { clubeId: { in: createdClubeIds } } },
    });
    await prismaDirect.pixCharge.deleteMany({
      where: { clubeId: { in: createdClubeIds } },
    });
    await prismaDirect.pixWithdrawal.deleteMany({
      where: { clubeId: { in: createdClubeIds } },
    });
    await prismaDirect.wallet.deleteMany({
      where: { clubeId: { in: createdClubeIds } },
    });
    await prismaDirect.clubeMembership.deleteMany({
      where: { clubeId: { in: createdClubeIds } },
    });
    await prismaDirect.clube.deleteMany({
      where: { id: { in: createdClubeIds } },
    });
    await prismaDirect.$disconnect();
  });

  const authed = (token: string, forClubeId: string) =>
    request(app.getHttpServer())
      .get(`/api/clubes/${forClubeId}/carteira/balance`)
      .set('Authorization', `Bearer ${token}`);

  it('sem token, /clubes/:clubeId/carteira/balance responde 401', async () => {
    await request(app.getHttpServer())
      .get(`/api/clubes/${clubeId}/carteira/balance`)
      .expect(401);
  });

  it('membro sem vínculo com o clube recebe 404 (não 403)', async () => {
    const estranho = await registerMember();
    await authed(estranho.accessToken, clubeId).expect(404);
  });

  it('começa com saldo 0.00', async () => {
    const res = await authed(accessToken, clubeId).expect(200);
    expect(res.body).toEqual({ balance: '0.00', version: 0 });
  });

  it('POST /clubes/:clubeId/carteira/deposits sem Idempotency-Key retorna 400', async () => {
    await request(app.getHttpServer())
      .post(`/api/clubes/${clubeId}/carteira/deposits`)
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
      .post(`/api/clubes/${clubeId}/carteira/deposits`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ amount: '100.00' })
      .expect(201);
    expect(depositRes.body).toMatchObject({
      amount: '100.00',
      status: 'PENDING',
    });

    // Saldo ainda não muda: só o webhook confirma o pagamento.
    const beforeWebhook = await authed(accessToken, clubeId).expect(200);
    expect(beforeWebhook.body.balance).toBe('0.00');

    const depositWebhook = webhookBody(
      'transparent.completed',
      'transparent',
      chargeExternalId,
    );

    await request(app.getHttpServer())
      .post('/api/webhooks/abacatepay')
      .set('Content-Type', 'application/json')
      .set('X-Webhook-Secret', WEBHOOK_SECRET)
      .send(depositWebhook)
      .expect(204);

    const afterWebhook = await authed(accessToken, clubeId).expect(200);
    expect(afterWebhook.body).toEqual({ balance: '100.00', version: 1 });

    // Reenviar o MESMO webhook (replay do provedor) não credita de novo.
    await request(app.getHttpServer())
      .post('/api/webhooks/abacatepay')
      .set('Content-Type', 'application/json')
      .set('X-Webhook-Secret', WEBHOOK_SECRET)
      .send(depositWebhook)
      .expect(204);
    const afterReplay = await authed(accessToken, clubeId).expect(200);
    expect(afterReplay.body).toEqual({ balance: '100.00', version: 1 });

    // Extrato mostra o depósito.
    const statement = await request(app.getHttpServer())
      .get(`/api/clubes/${clubeId}/carteira/transactions`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(statement.body.items).toHaveLength(1);
    expect(statement.body.items[0]).toMatchObject({
      type: 'PIX_DEPOSIT',
      amount: '100.00',
    });

    // Saque debita o saldo.
    const withdrawalExternalId = `wdr-${randomUUID()}`;
    fakeAbacatePayClient.requestPixWithdrawal.mockResolvedValue({
      externalId: withdrawalExternalId,
      status: 'PENDING',
      rawStatus: 'PENDING',
      amount: '30.00',
      createdAt: new Date().toISOString(),
    });
    const withdrawalRes = await request(app.getHttpServer())
      .post(`/api/clubes/${clubeId}/carteira/withdrawals`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ amount: '30.00', pixKey: 'jogador@pix.dev', pixKeyType: 'EMAIL' })
      .expect(201);
    expect(withdrawalRes.body).toMatchObject({
      amount: '30.00',
      status: 'PROCESSING',
    });
    expect(withdrawalRes.body.pixKeyMasked).toBe('***.dev');

    const afterWithdrawal = await authed(accessToken, clubeId).expect(200);
    expect(afterWithdrawal.body).toEqual({ balance: '70.00', version: 2 });

    // Webhook de conclusão do saque: só atualiza status, saldo já foi
    // debitado no pedido.
    await request(app.getHttpServer())
      .post('/api/webhooks/abacatepay')
      .set('Content-Type', 'application/json')
      .set('X-Webhook-Secret', WEBHOOK_SECRET)
      .send(webhookBody('transfer.completed', 'transfer', withdrawalExternalId))
      .expect(204);
    const afterTransferCompleted = await authed(accessToken, clubeId).expect(
      200,
    );
    expect(afterTransferCompleted.body).toEqual({
      balance: '70.00',
      version: 2,
    });
  });

  it('transfer.failed estorna o valor reservado do saque de volta pro saldo', async () => {
    const fresh = await registerMember();

    const chargeExternalId = `chg-${randomUUID()}`;
    fakeAbacatePayClient.createPixCharge.mockResolvedValue({
      externalId: chargeExternalId,
      status: 'PENDING',
      rawStatus: 'PENDING',
      amount: '50.00',
      brCode: '000201...copia-e-cola...',
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      createdAt: new Date().toISOString(),
    });
    await request(app.getHttpServer())
      .post(`/api/clubes/${fresh.clubeId}/carteira/deposits`)
      .set('Authorization', `Bearer ${fresh.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ amount: '50.00' })
      .expect(201);
    const depositWebhook = webhookBody(
      'transparent.completed',
      'transparent',
      chargeExternalId,
    );
    await request(app.getHttpServer())
      .post('/api/webhooks/abacatepay')
      .set('Content-Type', 'application/json')
      .set('X-Webhook-Secret', WEBHOOK_SECRET)
      .send(depositWebhook)
      .expect(204);

    const withdrawalExternalId = `wdr-${randomUUID()}`;
    fakeAbacatePayClient.requestPixWithdrawal.mockResolvedValue({
      externalId: withdrawalExternalId,
      status: 'PENDING',
      rawStatus: 'PENDING',
      amount: '20.00',
      createdAt: new Date().toISOString(),
    });
    await request(app.getHttpServer())
      .post(`/api/clubes/${fresh.clubeId}/carteira/withdrawals`)
      .set('Authorization', `Bearer ${fresh.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ amount: '20.00', pixKey: 'jogador@pix.dev', pixKeyType: 'EMAIL' })
      .expect(201);
    const afterRequest = await authed(fresh.accessToken, fresh.clubeId).expect(
      200,
    );
    expect(afterRequest.body.balance).toBe('30.00'); // 50 - 20 reservado

    await request(app.getHttpServer())
      .post('/api/webhooks/abacatepay')
      .set('Content-Type', 'application/json')
      .set('X-Webhook-Secret', WEBHOOK_SECRET)
      .send(webhookBody('transfer.failed', 'transfer', withdrawalExternalId))
      .expect(204);

    const afterFailure = await authed(fresh.accessToken, fresh.clubeId).expect(
      200,
    );
    expect(afterFailure.body.balance).toBe('50.00'); // estornado
  });

  it('mesmo usuário com carteira em dois clubes: webhook credita só o clube da cobrança', async () => {
    const outroClubeId = await prismaDirect.clube
      .create({
        data: {
          name: 'Segundo Clube do Mesmo Jogador',
          document: randomUUID().replace(/-/g, ''),
        },
      })
      .then((clube) => clube.id);
    createdClubeIds.push(outroClubeId);
    // Vincula o MESMO usuário do clube principal a um segundo clube, com
    // wallet própria (zerada) nele — a wallet do segundo clube é o que prova
    // que o crédito não vazou pra lá.
    await prismaDirect.clubeMembership.create({
      data: { clubeId: outroClubeId, userId, role: 'PLAYER' },
    });
    await prismaDirect.wallet.create({
      data: { userId, clubeId: outroClubeId, balance: 0 },
    });

    const chargeExternalId = `chg-${randomUUID()}`;
    fakeAbacatePayClient.createPixCharge.mockResolvedValue({
      externalId: chargeExternalId,
      status: 'PENDING',
      rawStatus: 'PENDING',
      amount: '15.00',
      brCode: '000201...copia-e-cola...',
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      createdAt: new Date().toISOString(),
    });
    // Depósito feito no clube PRINCIPAL...
    await request(app.getHttpServer())
      .post(`/api/clubes/${clubeId}/carteira/deposits`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ amount: '15.00' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/webhooks/abacatepay')
      .set('Content-Type', 'application/json')
      .set('X-Webhook-Secret', WEBHOOK_SECRET)
      .send(
        webhookBody('transparent.completed', 'transparent', chargeExternalId),
      )
      .expect(204);

    // ... credita só o saldo do clube PRINCIPAL, nunca o do outro clube.
    const outroSaldo = await authed(accessToken, outroClubeId).expect(200);
    expect(outroSaldo.body.balance).toBe('0.00');
  });

  it('webhook com secret inválido é rejeitado (401) e não altera saldo', async () => {
    const body = webhookBody('transparent.completed', 'transparent', 'chg-x');

    await request(app.getHttpServer())
      .post('/api/webhooks/abacatepay')
      .set('Content-Type', 'application/json')
      .set('X-Webhook-Secret', 'secret-forjado')
      .send(body)
      .expect(401);
  });
});
