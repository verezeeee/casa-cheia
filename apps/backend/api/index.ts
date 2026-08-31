import type { IncomingMessage, ServerResponse } from 'http';
import type { Express } from 'express';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

// A integração Vercel<->Neon cria `DATABASE_URL` travada pra edição manual no
// dashboard (gerenciada pela integração). `POSTGRES_PRISMA_URL` (também
// criada pela integração) é a URL certa pra uso via pooler — força os
// parâmetros que o Prisma precisa pra falar com PgBouncer em vez de confiar
// que já vêm certos: `pgbouncer=true` (desliga prepared statements, que o
// pooler não suporta) e `connect_timeout` (falha rápido em vez de pendurar).
// Só precisa ser lida antes de qualquer PrismaClient existir, já que o
// client lê `process.env.DATABASE_URL` (via `env()` no schema) no momento em
// que é instanciado, não no build. Local/CI não têm POSTGRES_PRISMA_URL —
// no-op, continua a DATABASE_URL do .env normal.
const pooledUrl = process.env.POSTGRES_PRISMA_URL;
if (pooledUrl) {
  const url = new URL(pooledUrl);
  url.searchParams.set('pgbouncer', 'true');
  if (!url.searchParams.has('connect_timeout')) {
    url.searchParams.set('connect_timeout', '15');
  }
  process.env.DATABASE_URL = url.toString();
}

/**
 * Entry point serverless (Vercel Functions). Alternativa ao `main.ts`
 * (`.listen()`), que não roda numa function — aqui inicializamos a app Nest
 * uma vez por instância "quente" (cache em módulo, sobrevive entre
 * invocações da mesma lambda) e delegamos o request/response direto pro
 * Express interno (`@nestjs/platform-express`, mesmo adapter default do
 * `main.ts`).
 *
 * SEM `serverless-http`: esse pacote não suporta Vercel (só lista AWS,
 * Genezio e Azure) — ele espera ser chamado como `handler(event, context)`
 * (formato de evento do API Gateway da AWS), não como `handler(req, res)`
 * (o formato nativo que a Vercel usa). Chamado do jeito errado, ele nunca
 * completa a resposta — a function trava até estourar o timeout, em
 * silêncio total. Um app Express, por si só, já É uma função
 * `(req, res) => void` válida — exatamente o formato que a Vercel espera.
 * Ver `bootstrap.ts` pra config compartilhada.
 */
let handlerPromise: Promise<Express> | undefined;

async function buildHandler(): Promise<Express> {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });

  configureApp(app);
  await app.init();

  return app.getHttpAdapter().getInstance() as Express;
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
  let expressApp: Express;
  try {
    expressApp = await handlerPromise;
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
  expressApp(req, res);
}
