import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import { Logger } from 'nestjs-pino';

/**
 * Configuração comum da app Nest (prefix, CORS, cookies, validação, logger),
 * compartilhada entre `main.ts` (`.listen()`, processo long-running local/docker)
 * e `api/index.ts` (`.init()`, function serverless da Vercel) — evita duplicar
 * regras sensíveis (CORS/cookies) entre os dois entry points.
 */
export function configureApp(app: INestApplication): INestApplication {
  app.useLogger(app.get(Logger));

  const configService = app.get(ConfigService);
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

  return app;
}
