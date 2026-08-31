import type { IncomingMessage, ServerResponse } from 'http';
import type { Express } from 'express';
import { NestFactory } from '@nestjs/core';
import serverlessHttp from 'serverless-http';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

// A integração Vercel<->Neon cria `DATABASE_URL` travada pra edição manual no
// dashboard (gerenciada pela integração). Confirmado em produção: `$connect()`
// funciona (handshake leve com o pooler), mas uma query real
// (`SELECT 1` do health check) fica pendurada os 300s inteiros — sintoma
// clássico de PgBouncer (transaction mode) recebendo prepared statements
// (protocolo estendido) que ele não sabe proxied direito sem `pgbouncer=true`.
// Em vez de confiar que a env var já vem com os parâmetros certos, força os
// dois que o Prisma precisa pra falar com um pooler: `pgbouncer=true`
// (desliga prepared statements) e `connect_timeout` (falha rápido em vez de
// pendurar). `POSTGRES_PRISMA_URL` (criada pela integração) é a base — só
// precisa ser lida antes de qualquer PrismaClient existir, já que o client lê
// `process.env.DATABASE_URL` (via `env()` no schema) no momento em que é
// instanciado, não no build. Local/CI não têm POSTGRES_PRISMA_URL — no-op,
// continua a DATABASE_URL do .env normal.
const pooledUrl = process.env.POSTGRES_PRISMA_URL;
if (pooledUrl) {
  const url = new URL(pooledUrl);
  url.searchParams.set('pgbouncer', 'true');
  if (!url.searchParams.has('connect_timeout')) {
    url.searchParams.set('connect_timeout', '15');
  }
  process.env.DATABASE_URL = url.toString();
}

console.log(
  '[boot] api/index.ts módulo carregado, POSTGRES_PRISMA_URL:',
  !!process.env.POSTGRES_PRISMA_URL,
);

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
  console.log('[boot] buildHandler: chamando NestFactory.create...');
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });

  console.log('[boot] NestFactory.create retornou, chamando app.init()...');

  configureApp(app);
  await app.init();

  console.log('[boot] app.init() retornou.');

  return serverlessHttp(app.getHttpAdapter().getInstance() as Express);
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  console.log('[boot] handler invocado:', req.url);
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
