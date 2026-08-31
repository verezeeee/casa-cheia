import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '../src/generated/prisma';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { AbacatePayClient } from './../src/integrations/abacatepay';

/** Cliente direto ao Postgres: monta clube/vínculo sem passar pela API (não há `POST /clubes`, ADR-0003). */
const prismaDirect = new PrismaClient();

/** Ids criados pela suíte, para o teardown (vínculo antes do clube: FK Restrict). */
const createdClubeIds: string[] = [];

/** 6 dígitos, primeiro dígito 1-9 — mesmo formato de `ClubService.generateJoinCode`. */
function randomJoinCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function createClube(): Promise<string> {
  const clube = await prismaDirect.clube.create({
    data: {
      name: 'Clube Mesas E2E',
      document: randomUUID().replace(/-/g, ''),
      joinCode: randomJoinCode(),
    },
  });
  createdClubeIds.push(clube.id);
  return clube.id;
}

/**
 * Não há endpoint de "promover a ADMIN" no MVP (fora de escopo) — o teste
 * cria o vínculo `ClubeMembership` direto no banco, como já faz
 * `tenant-isolation.int-spec.ts` (papel agora vive na aresta usuário↔clube,
 * não mais em `User.role` — ver `club.prisma`).
 */
async function registerAndLogin(
  app: INestApplication<App>,
  clubeId: string,
  opts: { admin?: boolean } = {},
): Promise<{ accessToken: string; userId: string }> {
  const email = `${randomUUID()}@table-e2e.test`;
  const registerRes = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({ email, password: 'senha-forte-123', name: 'Jogador Mesa' })
    .expect(201);

  await prismaDirect.clubeMembership.create({
    data: {
      clubeId,
      userId: registerRes.body.id as string,
      role: opts.admin ? 'ADMIN' : 'PLAYER',
      status: 'ACTIVE',
    },
  });

  const loginRes = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password: 'senha-forte-123' })
    .expect(200);

  return {
    accessToken: loginRes.body.accessToken as string,
    userId: registerRes.body.id as string,
  };
}

async function creditWallet(
  userId: string,
  clubeId: string,
  amount: string,
): Promise<void> {
  const wallet = await prismaDirect.wallet.upsert({
    where: { userId_clubeId: { userId, clubeId } },
    create: { userId, clubeId, balance: '0.00' },
    update: {},
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

/** Lê o saldo direto do banco — `GET /api/wallet/balance` está 501 até CL-BE-07 migrar a rota de carteira. */
async function getBalance(userId: string, clubeId: string): Promise<string> {
  const wallet = await prismaDirect.wallet.findUniqueOrThrow({
    where: { userId_clubeId: { userId, clubeId } },
  });
  return wallet.balance.toFixed(2);
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
    // Ordem de FK Restrict (filho antes do pai): StackMovement ->
    // WalletTransaction -> TableSession/Wallet -> Table -> Membership -> Clube.
    await prismaDirect.stackMovement.deleteMany({
      where: { tableSession: { clubeId: { in: createdClubeIds } } },
    });
    await prismaDirect.walletTransaction.deleteMany({
      where: { wallet: { clubeId: { in: createdClubeIds } } },
    });
    await prismaDirect.tableSession.deleteMany({
      where: { clubeId: { in: createdClubeIds } },
    });
    await prismaDirect.wallet.deleteMany({
      where: { clubeId: { in: createdClubeIds } },
    });
    await prismaDirect.table.deleteMany({
      where: { clubeId: { in: createdClubeIds } },
    });
    await prismaDirect.clubeMembership.deleteMany({
      where: { clubeId: { in: createdClubeIds } },
    });
    await prismaDirect.clube.deleteMany({
      where: { id: { in: createdClubeIds } },
    });
    await app.close();
    await prismaDirect.$disconnect();
  });

  it('PLAYER não pode criar mesa (403)', async () => {
    const clubeId = await createClube();
    const { accessToken } = await registerAndLogin(app, clubeId);

    await request(app.getHttpServer())
      .post(`/api/clubes/${clubeId}/mesas`)
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

  it('quem não é membro do clube recebe 404 (não 403)', async () => {
    const clubeId = await createClube();
    const estranhoClubeId = await createClube();
    const { accessToken } = await registerAndLogin(app, estranhoClubeId);

    await request(app.getHttpServer())
      .get(`/api/clubes/${clubeId}/mesas`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(404);
  });

  it('fluxo completo: ADMIN cria mesa -> PLAYER senta (buy-in) -> ADMIN registra resultado -> PLAYER cash-out', async () => {
    const clubeId = await createClube();
    const admin = await registerAndLogin(app, clubeId, { admin: true });
    const player = await registerAndLogin(app, clubeId);
    await creditWallet(player.userId, clubeId, '500.00');

    const createRes = await request(app.getHttpServer())
      .post(`/api/clubes/${clubeId}/mesas`)
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
      .get(`/api/clubes/${clubeId}/mesas`)
      .set('Authorization', `Bearer ${player.accessToken}`)
      .expect(200);
    expect(
      lobbyRes.body.items.some((t: { id: string }) => t.id === tableId),
    ).toBe(true);

    // Assentos vazios inicialmente.
    const emptySeats = await request(app.getHttpServer())
      .get(`/api/clubes/${clubeId}/mesas/${tableId}/seats`)
      .set('Authorization', `Bearer ${player.accessToken}`)
      .expect(200);
    expect(emptySeats.body).toHaveLength(6);
    expect(
      emptySeats.body.every((s: { userId: null }) => s.userId === null),
    ).toBe(true);

    // PLAYER senta com buy-in de 100.
    const sitRes = await request(app.getHttpServer())
      .post(`/api/clubes/${clubeId}/mesas/${tableId}/sit`)
      .set('Authorization', `Bearer ${player.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ seatNumber: 2, buyInAmount: '100.00' })
      .expect(201);
    expect(sitRes.body).toMatchObject({
      seatNumber: 2,
      currentStack: '100.00',
    });

    // Saldo da wallet foi debitado.
    expect(await getBalance(player.userId, clubeId)).toBe('400.00');

    // Sentar de novo no mesmo assento é rejeitado (índice único parcial).
    const other = await registerAndLogin(app, clubeId);
    await creditWallet(other.userId, clubeId, '500.00');
    await request(app.getHttpServer())
      .post(`/api/clubes/${clubeId}/mesas/${tableId}/sit`)
      .set('Authorization', `Bearer ${other.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ seatNumber: 2, buyInAmount: '100.00' })
      .expect(409);

    // Descobre o id da sessão via /seats (não é devolvido em outro lugar).
    const seatsRes = await request(app.getHttpServer())
      .get(`/api/clubes/${clubeId}/mesas/${tableId}/seats`)
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
      .post(
        `/api/clubes/${clubeId}/mesas/${tableId}/sessions/${session.id}/movements`,
      )
      .set('Authorization', `Bearer ${player.accessToken}`)
      .send({ amount: '50.00', reason: 'HAND_RESULT' })
      .expect(403);

    // ADMIN registra uma mão ganha de +50.
    const movementRes = await request(app.getHttpServer())
      .post(
        `/api/clubes/${clubeId}/mesas/${tableId}/sessions/${session.id}/movements`,
      )
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ amount: '50.00', reason: 'HAND_RESULT' })
      .expect(201);
    expect(movementRes.body.currentStack).toBe('150.00');

    // PLAYER faz cash-out do stack inteiro (150).
    const cashOutRes = await request(app.getHttpServer())
      .post(
        `/api/clubes/${clubeId}/mesas/${tableId}/sessions/${session.id}/cash-out`,
      )
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
    expect(await getBalance(player.userId, clubeId)).toBe('550.00');

    // Assento voltou a ficar livre — outro jogador pode sentar nele.
    const finalSeats = await request(app.getHttpServer())
      .get(`/api/clubes/${clubeId}/mesas/${tableId}/seats`)
      .set('Authorization', `Bearer ${player.accessToken}`)
      .expect(200);
    expect(finalSeats.body[1]).toMatchObject({ seatNumber: 2, userId: null });
  });

  describe('ADMIN senta outro jogador', () => {
    async function createOpenTable(
      admin: { accessToken: string },
      clubeId: string,
    ): Promise<string> {
      const res = await request(app.getHttpServer())
        .post(`/api/clubes/${clubeId}/mesas`)
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
      return res.body.id as string;
    }

    it('PLAYER não pode sentar outro membro nem convidado (403)', async () => {
      const clubeId = await createClube();
      const admin = await registerAndLogin(app, clubeId, { admin: true });
      const player = await registerAndLogin(app, clubeId);
      const other = await registerAndLogin(app, clubeId);
      const tableId = await createOpenTable(admin, clubeId);

      await request(app.getHttpServer())
        .post(`/api/clubes/${clubeId}/mesas/${tableId}/sit/${other.userId}`)
        .set('Authorization', `Bearer ${player.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({ seatNumber: 1, buyInAmount: '50.00' })
        .expect(403);

      await request(app.getHttpServer())
        .post(`/api/clubes/${clubeId}/mesas/${tableId}/sit-guest`)
        .set('Authorization', `Bearer ${player.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          seatNumber: 1,
          buyInAmount: '50.00',
          name: 'Fulano',
          phone: '11988887777',
        })
        .expect(403);
    });

    it('ADMIN senta um membro de OUTRO clube: 404 (não deixa debitar wallet de fora do clube)', async () => {
      const clubeId = await createClube();
      const outroClubeId = await createClube();
      const admin = await registerAndLogin(app, clubeId, { admin: true });
      const forasteiro = await registerAndLogin(app, outroClubeId);
      const tableId = await createOpenTable(admin, clubeId);

      await request(app.getHttpServer())
        .post(
          `/api/clubes/${clubeId}/mesas/${tableId}/sit/${forasteiro.userId}`,
        )
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({ seatNumber: 1, buyInAmount: '50.00' })
        .expect(404);
    });

    it('ADMIN senta um membro já cadastrado — buy-in sai da wallet DELE, não da do admin', async () => {
      const clubeId = await createClube();
      const admin = await registerAndLogin(app, clubeId, { admin: true });
      const player = await registerAndLogin(app, clubeId);
      await creditWallet(player.userId, clubeId, '500.00');
      const tableId = await createOpenTable(admin, clubeId);

      const sitRes = await request(app.getHttpServer())
        .post(`/api/clubes/${clubeId}/mesas/${tableId}/sit/${player.userId}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({ seatNumber: 1, buyInAmount: '100.00' })
        .expect(201);
      expect(sitRes.body).toMatchObject({
        seatNumber: 1,
        userId: player.userId,
        currentStack: '100.00',
      });
      expect(await getBalance(player.userId, clubeId)).toBe('400.00');
    });

    it('ADMIN senta um jogador SEM CADASTRO (nome+telefone) e depois faz cash-out dele', async () => {
      const clubeId = await createClube();
      const admin = await registerAndLogin(app, clubeId, { admin: true });
      const tableId = await createOpenTable(admin, clubeId);

      const sitRes = await request(app.getHttpServer())
        .post(`/api/clubes/${clubeId}/mesas/${tableId}/sit-guest`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          seatNumber: 4,
          buyInAmount: '80.00',
          name: 'Convidado Balcão',
          phone: '11999998888',
        })
        .expect(201);
      expect(sitRes.body).toMatchObject({
        seatNumber: 4,
        userName: 'Convidado Balcão',
        currentStack: '80.00',
      });
      const guestUserId = sitRes.body.userId as string;

      // O convidado agora existe como membro (isGuest: true) — aparece na
      // busca de membro, mas não loga (sem senha conhecida).
      const membersRes = await request(app.getHttpServer())
        .get(`/api/clubes/${clubeId}/membros`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);
      expect(membersRes.body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            userId: guestUserId,
            isGuest: true,
            phone: '11999998888',
          }),
        ]),
      );

      const session = await prismaDirect.tableSession.findFirstOrThrow({
        where: { tableId, userId: guestUserId, status: 'ACTIVE' },
      });

      // Convidado nunca loga — só o admin pode encerrar a sessão dele.
      const cashOutRes = await request(app.getHttpServer())
        .post(
          `/api/clubes/${clubeId}/mesas/${tableId}/sessions/${session.id}/admin-cash-out`,
        )
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .expect(201);
      expect(cashOutRes.body).toEqual({
        seatNumber: 4,
        userId: null,
        userName: null,
        currentStack: null,
        sessionId: null,
      });
      // Saldo final na wallet do convidado = os 80 que ele "trouxe" em
      // espécie e recuperou no cash-out — fica lá até o balcão pagar em
      // dinheiro (fluxo fora do escopo desta feature, ver plano).
      expect(await getBalance(guestUserId, clubeId)).toBe('80.00');
    });
  });
});
