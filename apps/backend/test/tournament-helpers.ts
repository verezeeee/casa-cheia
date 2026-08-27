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
 * Fixtures compartilhadas das suítes de torneio (`tournament.e2e-spec.ts` e
 * `tournament-tables.e2e-spec.ts`). Vive fora de um `*.e2e-spec.ts` de
 * propósito: `testRegex` do jest-e2e só casa `.e2e-spec.ts$`, então este
 * arquivo é importado, nunca executado como suíte.
 */

/** Cliente direto ao Postgres: monta estado e confere invariantes sem passar pela API. */
export const prismaDirect = new PrismaClient();

/** O mesmo boot do `main.ts` (prefixo, cookies, ValidationPipe), com o gateway PIX mockado. */
export async function bootstrapTestApp(): Promise<INestApplication<App>> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(AbacatePayClient)
    .useValue({ createPixCharge: jest.fn(), requestPixWithdrawal: jest.fn() })
    .compile();

  const app = moduleFixture.createNestApplication<INestApplication<App>>();
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  // `listen(0)` de propósito, e não só `init()`: sem um listener próprio o
  // supertest abre UM servidor efêmero por request e o fecha ao terminar —
  // com requests concorrentes (`Promise.all`), o primeiro a terminar derruba
  // o socket dos outros (ECONNRESET). Um listener único para a suíte inteira
  // elimina o artefato de harness sem mexer no que está sendo testado.
  await app.listen(0);
  return app;
}

export async function registerAndLogin(
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

export async function creditWallet(
  userId: string,
  amount: string,
): Promise<void> {
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

/**
 * Invariantes de assento (MT-BE-05), verdadeiras DEPOIS de qualquer operação:
 *
 * 1. `count(seats ativos) == count(entries vivas)` — ninguém no ar.
 * 2. o conjunto de entries sentadas é exatamente o conjunto de entries vivas —
 *    ninguém sentado depois de eliminado, ninguém em dois assentos.
 * 3. nenhum par (mesa, assento) ativo repetido.
 * 4. nenhum assento ativo em mesa `CLOSED`.
 * 5. ocupação: `max(mesas abertas) - min(mesas abertas COM VAGA) <= 1`
 *    (decisão (c) de `seating.ts`: sem vaga em lugar nenhum o desequilíbrio é
 *    legítimo, porque rebalancear não abre mesa).
 */
export async function expectSeatInvariants(
  tournamentId: string,
): Promise<void> {
  const tables = await prismaDirect.tournamentTable.findMany({
    where: { tournamentId },
    include: { seats: { where: { active: true } } },
  });
  const alive = await prismaDirect.tournamentEntry.findMany({
    where: { tournamentId, status: { in: ['REGISTERED', 'PLAYING'] } },
    select: { id: true },
  });

  const activeSeats = tables.flatMap((table) =>
    table.seats.map((seat) => ({ ...seat, tableStatus: table.status })),
  );

  expect(activeSeats).toHaveLength(alive.length);
  expect(
    [...new Set(activeSeats.map((s) => s.tournamentEntryId))].sort(),
  ).toEqual(alive.map((e) => e.id).sort());

  const places = activeSeats.map(
    (s) => `${s.tournamentTableId}#${s.seatNumber}`,
  );
  expect(new Set(places).size).toBe(places.length);

  expect(activeSeats.filter((s) => s.tableStatus === 'CLOSED')).toEqual([]);

  const open = tables.filter((t) => t.status === 'OPEN');
  const withRoom = open.filter((t) => t.seats.length < t.capacity);
  if (open.length > 1 && withRoom.length > 0) {
    const fullest = Math.max(...open.map((t) => t.seats.length));
    const emptiestWithRoom = Math.min(...withRoom.map((t) => t.seats.length));
    expect(fullest - emptiestWithRoom).toBeLessThanOrEqual(1);
  }
}
