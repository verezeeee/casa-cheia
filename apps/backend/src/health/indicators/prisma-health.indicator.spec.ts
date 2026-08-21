import { HealthCheckError } from '@nestjs/terminus';
import { PrismaService } from '../../prisma/prisma.service';
import { PrismaHealthIndicator } from './prisma-health.indicator';

describe('PrismaHealthIndicator', () => {
  it('retorna status "up" quando a query de verificação do Prisma tem sucesso', async () => {
    const prisma = {
      isHealthy: jest.fn().mockResolvedValue(true),
    } as unknown as PrismaService;
    const indicator = new PrismaHealthIndicator(prisma);

    const result = await indicator.isHealthy('database');

    expect(result).toEqual({ database: { status: 'up' } });
  });

  it('lança HealthCheckError com status "down" quando o banco não responde', async () => {
    const prisma = {
      isHealthy: jest.fn().mockRejectedValue(new Error('connection refused')),
    } as unknown as PrismaService;
    const indicator = new PrismaHealthIndicator(prisma);

    await expect(indicator.isHealthy('database')).rejects.toBeInstanceOf(
      HealthCheckError,
    );
    try {
      await indicator.isHealthy('database');
      fail('deveria ter lançado');
    } catch (err) {
      expect(err).toBeInstanceOf(HealthCheckError);
      const healthError = err as HealthCheckError;
      expect(healthError.causes).toEqual({
        database: { status: 'down', message: 'connection refused' },
      });
    }
  });
});
