import type { IncomingMessage, ServerResponse } from 'http';
import type { Express } from 'express';
import { NestFactory } from '@nestjs/core';
import serverlessHttp from 'serverless-http';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

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
  const serverlessHandler = await handlerPromise;
  await serverlessHandler(req, res);
}
