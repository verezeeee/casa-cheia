import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(Logger));

  const configService = app.get(ConfigService);
  const port = configService.get<number>('app.port') ?? 3001;
  const apiPrefix = configService.get<string>('app.apiPrefix') ?? 'api';
  const corsOrigins = configService.get<string[]>('security.corsOrigins') ?? [];

  app.setGlobalPrefix(apiPrefix);
  // `credentials: true` é obrigatório para o cookie httpOnly de refresh
  // token trafegar entre origens distintas (frontend/backend em portas
  // diferentes); com `origin: '*'` (default do enableCors()) o browser
  // recusa cookies em requisições cross-origin, então a lista precisa ser
  // explícita.
  app.enableCors({ origin: corsOrigins, credentials: true });
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.listen(port);
}

bootstrap().catch((error: unknown) => {
  console.error('Falha ao inicializar a aplicação:', error);
  process.exit(1);
});
