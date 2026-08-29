import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { ClubModule } from './club/club.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import {
  abacatePayConfig,
  appConfig,
  databaseConfig,
  jwtConfig,
  securityConfig,
  walletConfig,
} from './config/configuration';
import { envValidationSchema } from './config/env.validation';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { TableModule } from './table/table.module';
import { TournamentModule } from './tournament/tournament.module';
import { WalletModule } from './wallet/wallet.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env'],
      load: [
        appConfig,
        databaseConfig,
        jwtConfig,
        abacatePayConfig,
        securityConfig,
        walletConfig,
      ],
      validationSchema: envValidationSchema,
      validationOptions: {
        abortEarly: false,
      },
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        autoLogging: true,
        redact: ['req.headers.authorization', 'req.headers.cookie'],
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty', options: { singleLine: true } }
            : undefined,
      },
    }),
    // Guard global (abaixo) fica com um limite generoso — não deve atrapalhar
    // tráfego normal (ex.: polling de assentos a cada 5s). Rotas sensíveis
    // (login, depósito, saque) sobrescrevem com @Throttle(SENSITIVE_ROUTE_THROTTLE),
    // que usa RATE_LIMIT_TTL/RATE_LIMIT_LIMIT (ver common/http/rate-limits.ts).
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 300 }],
    }),
    PrismaModule,
    HealthModule,
    AuthModule,
    ClubModule,
    WalletModule,
    TableModule,
    TournamentModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
