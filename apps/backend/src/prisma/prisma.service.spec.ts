import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  let service: PrismaService;

  beforeEach(() => {
    service = new PrismaService();
    jest.spyOn(service, '$connect').mockResolvedValue(undefined);
    jest.spyOn(service, '$disconnect').mockResolvedValue(undefined);
  });

  it('conecta ao banco em onModuleInit', async () => {
    await service.onModuleInit();
    expect(service.$connect).toHaveBeenCalledTimes(1);
  });

  it('desconecta do banco em onModuleDestroy', async () => {
    await service.onModuleDestroy();
    expect(service.$disconnect).toHaveBeenCalledTimes(1);
  });

  it('isHealthy executa um SELECT 1 e retorna true quando o banco responde', async () => {
    jest.spyOn(service, '$queryRaw').mockResolvedValue([{ '?column?': 1 }]);

    await expect(service.isHealthy()).resolves.toBe(true);
    expect(service.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('isHealthy propaga o erro quando a query falha (banco indisponível)', async () => {
    jest
      .spyOn(service, '$queryRaw')
      .mockRejectedValue(new Error('connection refused'));

    await expect(service.isHealthy()).rejects.toThrow('connection refused');
  });
});
