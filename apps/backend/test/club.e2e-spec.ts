import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ClubeRole, ClubeStatus, PrismaClient } from '../src/generated/prisma';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { AbacatePayClient } from './../src/integrations/abacatepay';

/** Cliente direto ao Postgres: monta clubes e vínculos sem passar pela API — não há `POST /clubes` (ADR-0003). */
const prismaDirect = new PrismaClient();

/** Ids criados pela suíte, para o teardown (vínculo antes do clube: FK Restrict). */
const createdClubeIds: string[] = [];

describe('Clubes (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AbacatePayClient)
      .useValue({ createPixCharge: jest.fn(), requestPixWithdrawal: jest.fn() })
      .compile();

    app = moduleFixture.createNestApplication<INestApplication<App>>();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.listen(0);
  });

  afterAll(async () => {
    // `wallet` antes de `clubeMembership`/`clube` (FK Restrict) — só existe
    // porque o cadastro de usuário novo (`POST .../membros` sem `userId`)
    // cria carteira junto do vínculo.
    await prismaDirect.wallet.deleteMany({
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

  async function registerAndLogin(): Promise<{
    accessToken: string;
    userId: string;
  }> {
    const email = `${randomUUID()}@club-e2e.test`;
    const registerRes = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password: 'senha-forte-123', name: 'Membro E2E' })
      .expect(201);
    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: 'senha-forte-123' })
      .expect(200);

    return {
      accessToken: loginRes.body.accessToken as string,
      userId: registerRes.body.id as string,
    };
  }

  async function createClube(
    name: string,
    status: ClubeStatus = 'ACTIVE',
  ): Promise<string> {
    const clube = await prismaDirect.clube.create({
      data: { name, document: randomUUID().replace(/-/g, ''), status },
    });
    createdClubeIds.push(clube.id);
    return clube.id;
  }

  async function addMember(
    clubeId: string,
    userId: string,
    role: ClubeRole,
    status: 'ACTIVE' | 'REVOKED' = 'ACTIVE',
  ): Promise<void> {
    await prismaDirect.clubeMembership.create({
      data: { clubeId, userId, role, status },
    });
  }

  const get = (path: string, token: string) =>
    request(app.getHttpServer())
      .get(`/api/${path}`)
      .set('Authorization', `Bearer ${token}`);

  it('sem token, GET /clubes responde 401', async () => {
    await request(app.getHttpServer()).get('/api/clubes').expect(401);
  });

  it('lista apenas os clubes com vínculo ACTIVE do próprio usuário', async () => {
    const user = await registerAndLogin();
    const meu = await createClube('Clube do Membro');
    const revogado = await createClube('Clube Desligado');
    const alheio = await createClube('Clube Alheio');

    await addMember(meu, user.userId, 'PLAYER');
    await addMember(revogado, user.userId, 'PLAYER', 'REVOKED');

    const res = await get('clubes', user.accessToken).expect(200);
    const ids = (res.body as Array<{ id: string }>).map((c) => c.id);

    expect(ids).toContain(meu);
    expect(ids).not.toContain(revogado); // vínculo REVOKED some da lista
    expect(ids).not.toContain(alheio); // clube de terceiro nunca aparece
    expect(res.body).toContainEqual({
      id: meu,
      name: 'Clube do Membro',
      status: 'ACTIVE',
      role: 'PLAYER',
    });
  });

  it('clube SUSPENDED continua na lista (bloqueio é operacional, não de visibilidade)', async () => {
    const user = await registerAndLogin();
    const suspenso = await createClube('Clube Suspenso', 'SUSPENDED');
    await addMember(suspenso, user.userId, 'PLAYER');

    const res = await get('clubes', user.accessToken).expect(200);
    expect(res.body).toContainEqual(
      expect.objectContaining({ id: suspenso, status: 'SUSPENDED' }),
    );
  });

  it('GET /clubes/:id: membro vê o detalhe, quem não é membro recebe 404', async () => {
    const membro = await registerAndLogin();
    const estranho = await registerAndLogin();
    const clubeId = await createClube('Clube Fechado');
    await addMember(clubeId, membro.userId, 'ADMIN');

    const res = await get(`clubes/${clubeId}`, membro.accessToken).expect(200);
    expect(res.body).toMatchObject({ id: clubeId, role: 'ADMIN' });

    // 404 e não 403: 403 confirmaria a existência do clube para quem não tem acesso.
    await get(`clubes/${clubeId}`, estranho.accessToken).expect(404);
  });

  it('membros: ADMIN lista e convida; não-ADMIN recebe 403', async () => {
    const admin = await registerAndLogin();
    const player = await registerAndLogin();
    const convidado = await registerAndLogin();
    const clubeId = await createClube('Clube com Membros');
    await addMember(clubeId, admin.userId, 'ADMIN');
    await addMember(clubeId, player.userId, 'PLAYER');

    await get(`clubes/${clubeId}/membros`, player.accessToken).expect(403);
    await request(app.getHttpServer())
      .post(`/api/clubes/${clubeId}/membros`)
      .set('Authorization', `Bearer ${player.accessToken}`)
      .send({ userId: convidado.userId, role: 'ADMIN' })
      .expect(403);

    const criado = await request(app.getHttpServer())
      .post(`/api/clubes/${clubeId}/membros`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ userId: convidado.userId, role: 'CASHIER' })
      .expect(201);
    expect(criado.body).toMatchObject({
      userId: convidado.userId,
      role: 'CASHIER',
      status: 'ACTIVE',
    });

    // Mesmo endpoint promove o vínculo existente (upsert por (clube, usuário)).
    await request(app.getHttpServer())
      .post(`/api/clubes/${clubeId}/membros`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ userId: convidado.userId, role: 'TOURNAMENT_DIRECTOR' })
      .expect(201);

    const membros = await get(
      `clubes/${clubeId}/membros`,
      admin.accessToken,
    ).expect(200);
    expect(membros.body).toHaveLength(3);
    expect(membros.body).toContainEqual(
      expect.objectContaining({
        userId: convidado.userId,
        role: 'TOURNAMENT_DIRECTOR',
      }),
    );
  });

  it('admin cadastra um usuário novo (email+name, sem userId): senha temporária loga de verdade, carteira nasce junto', async () => {
    const admin = await registerAndLogin();
    const clubeId = await createClube('Clube Cadastro Direto');
    await addMember(clubeId, admin.userId, 'ADMIN');

    const email = `${randomUUID()}@club-e2e.test`;
    const criado = await request(app.getHttpServer())
      .post(`/api/clubes/${clubeId}/membros`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ email, name: 'Cadastrado no Balcão', role: 'PLAYER' })
      .expect(201);

    expect(criado.body).toMatchObject({
      name: 'Cadastrado no Balcão',
      email,
      role: 'PLAYER',
      status: 'ACTIVE',
    });
    const temporaryPassword = criado.body.temporaryPassword as string;
    expect(typeof temporaryPassword).toBe('string');
    expect(temporaryPassword.length).toBeGreaterThanOrEqual(10);
    const newUserId = criado.body.userId as string;

    // A senha devolvida É a senha real — login funciona de ponta a ponta.
    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: temporaryPassword })
      .expect(200);
    const newUserToken = loginRes.body.accessToken as string;

    // Carteira nasceu junto (fecha o TODO de `AuthService.register`).
    const balanceRes = await get(
      `clubes/${clubeId}/carteira/balance`,
      newUserToken,
    ).expect(200);
    expect(balanceRes.body.balance).toBe('0.00');

    // Aparece na listagem de membros do admin.
    const membros = await get(
      `clubes/${clubeId}/membros`,
      admin.accessToken,
    ).expect(200);
    expect(membros.body).toContainEqual(
      expect.objectContaining({ userId: newUserId, email, role: 'PLAYER' }),
    );

    // E-mail já cadastrado (o mesmo de novo) responde 409, não 500.
    await request(app.getHttpServer())
      .post(`/api/clubes/${clubeId}/membros`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ email, name: 'Duplicado', role: 'PLAYER' })
      .expect(409);

    // userId e email/name juntos: 400, não ambiguidade silenciosa.
    await request(app.getHttpServer())
      .post(`/api/clubes/${clubeId}/membros`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({
        userId: newUserId,
        email: 'outro@club-e2e.test',
        name: 'X',
        role: 'PLAYER',
      })
      .expect(400);
  });

  it('quem não é membro recebe 404 (não 403) ao tentar administrar membros', async () => {
    const estranho = await registerAndLogin();
    const clubeId = await createClube('Clube Invisível');

    await get(`clubes/${clubeId}/membros`, estranho.accessToken).expect(404);
  });

  it('admin não consegue remover o próprio acesso (anti-lockout)', async () => {
    const admin = await registerAndLogin();
    const clubeId = await createClube('Clube do Único Admin');
    await addMember(clubeId, admin.userId, 'ADMIN');

    await request(app.getHttpServer())
      .post(`/api/clubes/${clubeId}/membros`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ userId: admin.userId, role: 'PLAYER' })
      .expect(400);
  });
});
