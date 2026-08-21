import { HealthCheckService } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { PrismaHealthIndicator } from './indicators/prisma-health.indicator';

describe('HealthController', () => {
  let controller: HealthController;
  let healthCheckService: { check: jest.Mock };
  let prismaIndicator: { isHealthy: jest.Mock };

  beforeEach(() => {
    healthCheckService = {
      check: jest.fn().mockResolvedValue({ status: 'ok', details: {} }),
    };
    prismaIndicator = {
      isHealthy: jest.fn().mockResolvedValue({ database: { status: 'up' } }),
    };

    controller = new HealthController(
      healthCheckService as unknown as HealthCheckService,
      prismaIndicator as unknown as PrismaHealthIndicator,
    );
  });

  it('delega para HealthCheckService.check com o indicador do Prisma', async () => {
    const result = await controller.check();

    expect(healthCheckService.check).toHaveBeenCalledTimes(1);
    const [indicators] = healthCheckService.check.mock.calls[0];
    expect(indicators).toHaveLength(1);

    await indicators[0]();
    expect(prismaIndicator.isHealthy).toHaveBeenCalledWith('database');

    expect(result).toEqual({ status: 'ok', details: {} });
  });
});
