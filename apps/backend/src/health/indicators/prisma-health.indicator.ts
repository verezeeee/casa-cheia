import { Injectable } from '@nestjs/common';
import { HealthCheckError, HealthIndicatorResult } from '@nestjs/terminus';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Indicador de saúde customizado do Terminus para a conexão com o
 * PostgreSQL via Prisma. Executa `SELECT 1` (barato, não depende de
 * nenhuma tabela de domínio existir ainda).
 */
@Injectable()
export class PrismaHealthIndicator {
  constructor(private readonly prisma: PrismaService) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      await this.prisma.isHealthy();
      return { [key]: { status: 'up' } };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      throw new HealthCheckError('Prisma health check failed', {
        [key]: { status: 'down', message },
      });
    }
  }
}
