import { clubeScopeExtension, PrismaService } from './prisma.service';

const CLUBE = 'clube-aaa';
const OUTRO_CLUBE = 'clube-bbb';

/**
 * A extension é uma função pura de `{ model, operation, args }`: dá para
 * exercitá-la sem banco nenhum, que é requisito da suíte unitária (os testes
 * unitários do backend rodam sem Postgres no CI — ver .github/workflows/ci.yml).
 * O contato com o banco de verdade é coberto pelas suítes de integração.
 */
type AllOperations = (params: {
  model: string;
  operation: string;
  args: { where?: unknown; data?: unknown };
  query: (args: { where?: unknown; data?: unknown }) => Promise<unknown>;
}) => Promise<unknown>;

function runExtension(
  model: string,
  operation: string,
  args: { where?: unknown; data?: unknown },
  clubeId = CLUBE,
) {
  const query = jest.fn().mockResolvedValue('ok');
  const allOperations: AllOperations =
    clubeScopeExtension(clubeId).query.$allModels.$allOperations;

  return allOperations({ model, operation, args, query }).then(() => {
    expect(query).toHaveBeenCalledTimes(1);
    return query.mock.calls[0][0] as { where?: unknown; data?: unknown };
  });
}

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

  describe('withClube', () => {
    /** Ordem global das chamadas feitas dentro da transação. */
    let ordem: string[];
    let executeRaw: jest.Mock;
    let fakeTx: Record<string, unknown>;

    beforeEach(() => {
      ordem = [];
      executeRaw = jest.fn(() => {
        ordem.push('$executeRaw');
        return Promise.resolve(1);
      });
      fakeTx = {
        $executeRaw: executeRaw,
        table: {
          findMany: jest.fn(() => {
            ordem.push('table.findMany');
            return Promise.resolve([]);
          }),
        },
      };

      jest.spyOn(service, '$extends').mockReturnValue({
        $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(fakeTx),
      });
    });

    it('(a) executa set_config como a PRIMEIRA query da transação', async () => {
      await service.withClube(CLUBE, async (tx) => {
        await tx.table.findMany();
      });

      expect(ordem).toEqual(['$executeRaw', 'table.findMany']);
    });

    it('(a) passa o clubeId como bind parameter, nunca interpolado no SQL', async () => {
      await service.withClube(CLUBE, () => Promise.resolve(undefined));

      const [strings, ...values] = executeRaw.mock.calls[0] as [
        TemplateStringsArray,
        ...unknown[],
      ];
      expect(strings.join('?')).toBe(
        "SELECT set_config('app.current_clube_id', ?, true)",
      );
      expect(values).toEqual([CLUBE]);
      // O clubeId NÃO pode aparecer na parte estática do SQL: se aparecesse,
      // teria sido concatenado (injeção de SQL) em vez de bindado.
      expect(strings.join('')).not.toContain(CLUBE);
    });

    it('aplica a extension de escopo antes de abrir a transação e devolve o resultado do callback', async () => {
      const resultado = await service.withClube(CLUBE, () =>
        Promise.resolve(42),
      );

      expect(resultado).toBe(42);
      expect(service.$extends).toHaveBeenCalledTimes(1);
      expect(jest.mocked(service.$extends).mock.calls[0][0]).toMatchObject({
        name: 'clube-scope',
      });
    });

    it('propaga o erro do callback (rollback fica a cargo do $transaction)', async () => {
      await expect(
        service.withClube(CLUBE, () => Promise.reject(new Error('boom'))),
      ).rejects.toThrow('boom');
    });
  });

  describe('clubeScopeExtension — models escopados por clube', () => {
    it('(b) injeta clubeId no where de findMany, preservando os demais filtros', async () => {
      await expect(
        runExtension('Table', 'findMany', { where: { status: 'OPEN' } }),
      ).resolves.toEqual({ where: { status: 'OPEN', clubeId: CLUBE } });
    });

    it('(b) injeta clubeId mesmo quando a chamada não tem where nenhum', async () => {
      await expect(runExtension('Wallet', 'count', {})).resolves.toEqual({
        where: { clubeId: CLUBE },
      });
    });

    it.each([
      'findMany',
      'findFirst',
      'findUnique',
      'count',
      'update',
      'updateMany',
      'delete',
      'deleteMany',
    ])('(b) %s de model escopado sai com o filtro de clube', async (op) => {
      const args = await runExtension('Tournament', op, {
        where: { id: 'tid' },
      });
      expect(args.where).toEqual({ id: 'tid', clubeId: CLUBE });
    });

    it('(b) normaliza o nome PascalCase que o Prisma entrega ("TableSession" -> "tableSession")', async () => {
      // Regressão do pior modo de falha possível aqui: comparar "TableSession"
      // com a lista camelCase e o filtro virar um no-op silencioso.
      const args = await runExtension('TableSession', 'findMany', {});
      expect(args.where).toEqual({ clubeId: CLUBE });
    });

    it('(b) o clubeId do chokepoint sobrescreve um clubeId divergente vindo do chamador', async () => {
      const args = await runExtension('Table', 'findMany', {
        where: { clubeId: OUTRO_CLUBE },
      });
      expect(args.where).toEqual({ clubeId: CLUBE });
    });

    it('(c) create sem clubeId explícito recebe o campo preenchido pela extension', async () => {
      await expect(
        runExtension('Table', 'create', { data: { name: 'Mesa 1' } }),
      ).resolves.toEqual({ data: { name: 'Mesa 1', clubeId: CLUBE } });
    });

    it('(c) createMany carimba clubeId em cada linha do array', async () => {
      const args = await runExtension('TournamentEntry', 'createMany', {
        data: [{ userId: 'u1' }, { userId: 'u2' }],
      });
      expect(args.data).toEqual([
        { userId: 'u1', clubeId: CLUBE },
        { userId: 'u2', clubeId: CLUBE },
      ]);
    });

    it('operação sem where nem data (ex.: aggregate) passa intacta', async () => {
      const original: Record<string, unknown> = { _sum: { balance: true } };
      await expect(
        runExtension('Wallet', 'aggregate', original),
      ).resolves.toEqual(original);
    });
  });

  describe('clubeScopeExtension — models NÃO escopados', () => {
    it.each([
      ['User', 'findMany', { where: { email: 'a@b.c' } }],
      ['User', 'create', { data: { email: 'a@b.c' } }],
      ['RefreshToken', 'deleteMany', { where: { userId: 'u1' } }],
      ['ClubeMembership', 'findMany', { where: { userId: 'u1' } }],
      // Filho de Wallet: não tem coluna clube_id, o isolamento dele vem da FK
      // do pai já filtrado + RLS via EXISTS (CL-DB-03).
      ['WalletTransaction', 'create', { data: { walletId: 'w1' } }],
    ])('(d) %s.%s passa pela extension sem alteração', async (...args) => {
      const [model, operation, callArgs] = args as [
        string,
        string,
        { where?: unknown; data?: unknown },
      ];
      await expect(runExtension(model, operation, callArgs)).resolves.toEqual(
        callArgs,
      );
    });

    it('(d) não injeta clubeId em where de model não escopado', async () => {
      const forwarded = await runExtension('User', 'findMany', { where: {} });
      expect(forwarded.where).not.toHaveProperty('clubeId');
    });
  });
});
