import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  bootstrapTestApp,
  createTestClube,
  prismaDirect,
  registerAndLogin,
} from './tournament-helpers';

/**
 * Suíte dedicada ao módulo de pagamento EM STANDBY (`PAYMENTS_ENABLED=false`,
 * `wallet.paymentsEnabled` em `configuration.ts`) — o resto da suíte e2e
 * testa com o módulo LIGADO (`setup-env.ts` seta `PAYMENTS_ENABLED=true` de
 * propósito, pra continuar cobrindo "saldo insuficiente" de verdade). Aqui é
 * o oposto: prova que registrar em mesa/torneio funciona SEM depósito prévio.
 *
 * Sobe seu PRÓPRIO `TestingModule` (`bootstrapTestApp`), com a env trocada
 * ANTES do boot — `ConfigModule` só lê `process.env` na hora de compilar o
 * módulo. Restaura no `afterAll`: `jest-e2e.json` roda com `maxWorkers: 1`,
 * um processo Node só pra todos os arquivos — sem restaurar, a mudança
 * vazaria pras suítes que rodarem depois desta no mesmo worker.
 */
describe('Pagamentos em standby (e2e)', () => {
  let app: INestApplication<App>;
  let clubeId: string;

  beforeAll(async () => {
    process.env.PAYMENTS_ENABLED = 'false';
    app = await bootstrapTestApp();
    clubeId = await createTestClube('Clube Standby');
  });

  afterAll(async () => {
    await app.close();
    await prismaDirect.$disconnect();
    process.env.PAYMENTS_ENABLED = 'true';
  });

  it('carteira com saldo 0 senta numa mesa cash sem depositar nada antes', async () => {
    const admin = await registerAndLogin(app, { admin: true });
    const player = await registerAndLogin(app);

    const tableRes = await request(app.getHttpServer())
      .post(`/api/clubes/${clubeId}/mesas`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({
        name: 'Mesa Standby',
        type: 'CASH_GAME',
        smallBlind: '1.00',
        bigBlind: '2.00',
        minBuyIn: '40.00',
        maxBuyIn: '200.00',
        maxSeats: 6,
      })
      .expect(201);
    const tableId = tableRes.body.id as string;

    const sitRes = await request(app.getHttpServer())
      .post(`/api/clubes/${clubeId}/mesas/${tableId}/sit`)
      .set('Authorization', `Bearer ${player.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ seatNumber: 1, buyInAmount: '100.00' })
      .expect(201);
    expect(sitRes.body.currentStack).toBe('100.00');

    // O saldo nunca fica negativo (CHECK wallets_balance_non_negative) — o
    // ajuste automático cobre o buy-in e o débito consome exatamente ele,
    // saldo final 0, tudo rastreável no extrato (não é dinheiro "de graça"
    // invisível).
    const wallet = await prismaDirect.wallet.findUniqueOrThrow({
      where: { userId_clubeId: { userId: player.userId, clubeId } },
    });
    expect(wallet.balance.toFixed(2)).toBe('0.00');

    const transactions = await prismaDirect.walletTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(transactions.map((t) => t.type)).toEqual([
      'ADJUSTMENT',
      'TABLE_BUY_IN',
    ]);
    expect(transactions[0]?.description).toContain('standby');
  });

  it('carteira com saldo 0 se inscreve num torneio sem depositar nada antes', async () => {
    const admin = await registerAndLogin(app, { admin: true });
    const player = await registerAndLogin(app);

    const tournamentRes = await request(app.getHttpServer())
      .post(`/api/clubes/${clubeId}/torneios`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({
        name: 'Torneio Standby',
        buyIn: '90.00',
        fee: '10.00',
        startingStack: 10000,
        maxPlayers: 9,
        startsAt: new Date(Date.now() + 3_600_000).toISOString(),
        prizes: [{ position: 1, percentage: '100.00' }],
      })
      .expect(201);
    const tournamentId = tournamentRes.body.id as string;

    const entryRes = await request(app.getHttpServer())
      .post(`/api/clubes/${clubeId}/torneios/${tournamentId}/register`)
      .set('Authorization', `Bearer ${player.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    expect(entryRes.body).toMatchObject({
      status: 'REGISTERED',
      chipStack: 10000,
    });

    const wallet = await prismaDirect.wallet.findUniqueOrThrow({
      where: { userId_clubeId: { userId: player.userId, clubeId } },
    });
    expect(wallet.balance.toFixed(2)).toBe('0.00');
  });

  it('depósito e saque continuam indisponíveis (503) mesmo em standby', async () => {
    const player = await registerAndLogin(app);

    await request(app.getHttpServer())
      .post(`/api/clubes/${clubeId}/carteira/deposits`)
      .set('Authorization', `Bearer ${player.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ amount: '50.00' })
      .expect(503);

    await request(app.getHttpServer())
      .post(`/api/clubes/${clubeId}/carteira/withdrawals`)
      .set('Authorization', `Bearer ${player.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ amount: '50.00', pixKey: 'a@b.dev', pixKeyType: 'EMAIL' })
      .expect(503);
  });
});
