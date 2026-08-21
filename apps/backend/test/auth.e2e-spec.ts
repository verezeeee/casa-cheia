import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

/** Extrai o valor de um cookie específico do header `Set-Cookie` da resposta. */
function extractCookie(response: request.Response, name: string): string {
  const raw = response.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = raw?.find((c) => c.startsWith(`${name}=`));
  if (!cookie) {
    throw new Error(`Cookie "${name}" não encontrado na resposta.`);
  }
  return cookie.split(';')[0];
}

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  const email = `${randomUUID()}@auth-e2e.test`;
  const password = 'senha-forte-123';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

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
  });

  it('registra, mas não devolve tokens (cadastro não é login)', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password, name: 'Jogador E2E' })
      .expect(201);

    expect(response.body).toEqual({
      id: expect.any(String),
      email,
      name: 'Jogador E2E',
      role: 'PLAYER',
    });
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('rejeita cadastro com e-mail já usado (409)', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password, name: 'Duplicado' })
      .expect(409);
  });

  it('rejeita login com senha errada (401)', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: 'senha-errada' })
      .expect(401);
  });

  it('fluxo completo: login -> me -> refresh (rotação) -> reuso detectado -> logout', async () => {
    // 1. login
    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password })
      .expect(200);

    expect(loginRes.body).toEqual({
      accessToken: expect.any(String),
      expiresIn: expect.any(Number),
    });
    const firstAccessToken = loginRes.body.accessToken as string;
    const firstRefreshCookie = extractCookie(loginRes, 'refresh_token');

    // 2. /me com o access token
    const meRes = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${firstAccessToken}`)
      .expect(200);
    expect(meRes.body.email).toBe(email);

    // 2b. /me sem token -> 401
    await request(app.getHttpServer()).get('/api/auth/me').expect(401);

    // 3. refresh rotaciona o token
    const refreshRes = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', firstRefreshCookie)
      .expect(200);
    const secondRefreshCookie = extractCookie(refreshRes, 'refresh_token');
    expect(secondRefreshCookie).not.toBe(firstRefreshCookie);

    // 4. reapresentar o token JÁ ROTACIONADO (primeiro) é reuso -> 401 e derruba a família
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', firstRefreshCookie)
      .expect(401);

    // 5. como a família inteira foi revogada, o token mais recente TAMBÉM para de funcionar
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', secondRefreshCookie)
      .expect(401);
  });

  it('logout revoga o refresh token corrente', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password })
      .expect(200);
    const refreshCookie = extractCookie(loginRes, 'refresh_token');

    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Cookie', refreshCookie)
      .expect(204);

    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', refreshCookie)
      .expect(401);
  });
});
