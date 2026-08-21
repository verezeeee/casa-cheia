import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

/**
 * Teste de integração do GET /health.
 *
 * Requer um PostgreSQL acessível via DATABASE_URL (o do docker-compose
 * em ambiente local, ou o serviço "postgres" provisionado no pipeline
 * de CI - ver .github/workflows/ci.yml).
 */
describe('HealthController (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health retorna 200 e status "ok" com o indicador do banco "up"', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/health')
      .expect(200);

    expect(response.body.status).toBe('ok');
    expect(response.body.info.database.status).toBe('up');
    expect(response.body.details.database.status).toBe('up');
  });
});
