import type { IncomingMessage, ServerResponse } from 'http';
import type { Express } from 'express';
import { NestFactory } from '@nestjs/core';
import serverlessHttp from 'serverless-http';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

// A integração Vercel<->Neon cria `DATABASE_URL` travada pra edição manual no
// dashboard (gerenciada pela integração) e, nessa loja, ela não vem com os
// parâmetros que o Prisma precisa pra falar com o pooler (PgBouncer,
// transaction mode): `pgbouncer=true` (desliga prepared statements, que o
// pooler não suporta) e `connect_timeout`. Sem isso o `$connect()` passa mas
// uma query real fica pendurada esperando conexão em vez de dar erro.
// `POSTGRES_PRISMA_URL`, também criada pela integração, já vem com esses
// parâmetros — só precisa ser lida antes de qualquer PrismaClient existir,
// já que o client lê `process.env.DATABASE_URL` (via `env()` no schema) no
// momento em que é instanciado, não no build. Local/CI não têm
// POSTGRES_PRISMA_URL — no-op, continua a DATABASE_URL do .env normal.
if (process.env.POSTGRES_PRISMA_URL) {
  process.env.DATABASE_URL = process.env.POSTGRES_PRISMA_URL;
}

/**
 * Entry point serverless (Vercel Functions). Alternativa ao `main.ts`
 * (`.listen()`), que não roda numa function — aqui inicializamos a app Nest
 * uma vez por instância "quente" (cache em módulo, sobrevive entre
 * invocações da mesma lambda) e delegamos o request/response pro Express
 * interno (`@nestjs/platform-express`, mesmo adapter default do `main.ts`)
 * via `serverless-http`. Ver `bootstrap.ts` pra config compartilhada.
 */
let handlerPromise: Promise<ReturnType<typeof serverlessHttp>> | undefined;

async function buildHandler() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });

  configureApp(app);
  await app.init();

  return serverlessHttp(app.getHttpAdapter().getInstance() as Express);
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!handlerPromise) {
    handlerPromise = buildHandler();
    // Se a inicialização falhar (env inválida, banco fora, etc.), não cacheia
    // a promise rejeitada — senão a instância "quente" fica travada crashando
    // pra sempre até um cold start. Próxima invocação tenta de novo.
    handlerPromise.catch(() => {
      handlerPromise = undefined;
    });
  }
  let serverlessHandler: Awaited<typeof handlerPromise>;
  try {
    serverlessHandler = await handlerPromise;
  } catch (error) {
    // Sem isso, uma falha no boot (timeout de conexão, env inválida) nunca
    // escreve na `res` — a function fica pendurada até estourar os 300s de
    // timeout em vez de devolver o erro na hora.

    console.error('Falha ao inicializar a app Nest:', error);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({ statusCode: 500, message: 'Internal Server Error' }),
    );
    return;
  }
  await serverlessHandler(req, res);
}
