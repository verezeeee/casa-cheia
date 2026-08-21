import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  AbacatePayClient,
  DEFAULT_BASE_URL,
  DEFAULT_TIMEOUT_MS,
} from './abacatepay.client';
import type { AbacatePayConfig } from './types';

/**
 * Módulo de integração com o gateway PIX AbacatePay.
 *
 * Escopo fechado: exporta apenas o `AbacatePayClient`. A instância de
 * `HttpService` criada aqui é privada do módulo — nenhum outro módulo herda
 * a `baseURL`/timeout do gateway por acidente.
 *
 * O header `Authorization` NÃO é definido nos defaults do axios de
 * propósito: ele é montado por requisição dentro do client, para que a API
 * key exista em um único ponto do código e não fique pendurada num objeto
 * de configuração compartilhado (que apareceria em qualquer dump/log de
 * `httpService.axiosRef.defaults`).
 *
 * Registro em `AppModule` fica a cargo da task que consumir a integração.
 */
@Module({
  imports: [
    // Importado explicitamente (mesmo com `ConfigModule.forRoot({ isGlobal:
    // true })` no AppModule) para que o módulo seja auto-suficiente em
    // testes e em qualquer composição futura.
    ConfigModule,
    HttpModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const config =
          configService.get<AbacatePayConfig>('abacatePay') ?? ({} as const);

        return {
          baseURL: config.baseUrl ?? DEFAULT_BASE_URL,
          timeout: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          // Sem redirects automáticos: um 3xx vindo de um proxy não deve
          // reenviar o header de autorização para outro host.
          maxRedirects: 0,
        };
      },
    }),
  ],
  providers: [AbacatePayClient],
  exports: [AbacatePayClient],
})
export class AbacatePayModule {}
