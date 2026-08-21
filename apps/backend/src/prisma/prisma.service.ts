import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Wrapper injetável em torno do PrismaClient.
 *
 * - Conecta explicitamente em `onModuleInit` para que falhas de conexão
 *   com o banco apareçam cedo (fail-fast), em vez de na primeira query.
 * - Desconecta em `onModuleDestroy` para encerrar o pool de conexões de
 *   forma limpa (importante em testes e2e e em shutdown do processo).
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Conexão com o PostgreSQL (Prisma) estabelecida.');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Usado pelo health check para verificar, de forma barata, se o banco
   * está respondendo (sem depender de nenhuma tabela de domínio existir).
   */
  async isHealthy(): Promise<boolean> {
    await this.$queryRaw`SELECT 1`;
    return true;
  }
}
