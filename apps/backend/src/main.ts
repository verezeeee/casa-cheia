import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';

async function bootstrap(): Promise<void> {
  // `rawBody: true` popula `req.rawBody` (Buffer) em toda requisição, ao
  // lado do JSON já parseado — necessário para verificar a assinatura HMAC
  // do webhook do AbacatePay sobre os bytes EXATOS recebidos (ver
  // `wallet/abacatepay-webhook.controller.ts`).
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });

  configureApp(app);

  const port = app.get(ConfigService).get<number>('app.port') ?? 3001;
  await app.listen(port);
}

bootstrap().catch((error: unknown) => {
  console.error('Falha ao inicializar a aplicação:', error);
  process.exit(1);
});
