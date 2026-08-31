import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '../generated/prisma';

/**
 * Models cujo escopo de tenant é aplicado AUTOMATICAMENTE por `withClube`.
 *
 * São exatamente as cinco raízes de agregado que carregam `clube_id NOT NULL`
 * (ver `prisma/schema/club.prisma`). Nomes em camelCase — como o model aparece
 * no client (`prisma.tableSession`), não como aparece no schema.
 *
 * Os models FILHOS (`WalletTransaction`, `PixCharge`, `StackMovement`,
 * `TournamentTable`, ...) não estão aqui de propósito: não têm coluna
 * `clube_id` para filtrar. Ver a nota de defesa em profundidade no JSDoc de
 * `withClube`.
 */
export const CLUBE_SCOPED_MODELS = [
  'table',
  'tournament',
  'wallet',
  'tableSession',
  'tournamentEntry',
] as const;

const SCOPED_MODELS = new Set<string>(CLUBE_SCOPED_MODELS);

/** Operações que aceitam `where` e portanto recebem o filtro de tenant. */
const WHERE_OPERATIONS = new Set([
  'findMany',
  'findFirst',
  'findUnique',
  'count',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
]);

/** Operações que aceitam `data` e portanto recebem o carimbo de tenant. */
const DATA_OPERATIONS = new Set(['create', 'createMany']);

type ScopedArgs = { where?: unknown; data?: unknown };

/** `TableSession` (nome do model no Prisma) -> `tableSession` (nome no client). */
function toClientModelName(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

function withClubeId(data: unknown, clubeId: string): unknown {
  if (Array.isArray(data)) {
    return data.map((row: unknown) => ({
      ...(row as Record<string, unknown>),
      clubeId,
    }));
  }
  return { ...(data as Record<string, unknown>), clubeId };
}

/**
 * Args da Prisma Client Extension que injeta o escopo de clube.
 *
 * Exportada separada de `withClube` para poder ser exercitada em teste de
 * unidade sem banco: é uma função pura de `{ model, operation, args }`.
 *
 * O `clubeId` é aplicado por ÚLTIMO no spread, de propósito: se o chamador
 * passar um `clubeId` divergente no `where`/`data`, o do chokepoint vence.
 * Um service não deve conseguir escrever noutro tenant "por engano".
 */
export function clubeScopeExtension(clubeId: string) {
  return {
    name: 'clube-scope',
    query: {
      $allModels: {
        $allOperations({
          model,
          operation,
          args,
          query,
        }: {
          model: string;
          operation: string;
          args: ScopedArgs;
          query: (args: ScopedArgs) => Promise<unknown>;
        }): Promise<unknown> {
          // O Prisma entrega `model` no nome do SCHEMA (PascalCase:
          // "TableSession"), não no nome do client. Normalizar aqui é o que
          // impede o filtro de virar um no-op silencioso — o pior modo de
          // falha possível num controle de isolamento de tenant.
          if (!SCOPED_MODELS.has(toClientModelName(model))) {
            return query(args);
          }

          if (WHERE_OPERATIONS.has(operation)) {
            return query({
              ...args,
              where: { ...(args.where as Record<string, unknown>), clubeId },
            });
          }

          if (DATA_OPERATIONS.has(operation)) {
            return query({ ...args, data: withClubeId(args.data, clubeId) });
          }

          return query(args);
        },
      },
    },
  };
}

/**
 * Wrapper injetável em torno do PrismaClient.
 *
 * - Conecta explicitamente em `onModuleInit` para que falhas de conexão
 *   com o banco apareçam cedo (fail-fast), em vez de na primeira query.
 * - Desconecta em `onModuleDestroy` para encerrar o pool de conexões de
 *   forma limpa (importante em testes e2e e em shutdown do processo).
 * - Expõe `withClube`, o chokepoint único de tenant-scoping do backend.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  /**
   * Corre `op` com um timeout — sem isso, um host inalcançável (rede,
   * firewall, pooler recusando o protocolo estendido) trava a promise pra
   * sempre e a function serverless come os 300s de timeout inteiros em
   * silêncio total. Falhar rápido com uma mensagem clara vale mais do que
   * deixar o caller descobrir isso pelo timeout da plataforma.
   */
  private async withTimeout<T>(
    op: () => Promise<T>,
    label: string,
    ms: number,
  ): Promise<T> {
    let timer: NodeJS.Timeout;
    return Promise.race([
      op().finally(() => clearTimeout(timer)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(`PrismaService: ${label} não respondeu em ${ms}ms`),
            ),
          ms,
        );
      }),
    ]);
  }

  async onModuleInit(): Promise<void> {
    this.logger.log('[boot] onModuleInit: chamando $connect()...');
    await this.withTimeout(() => this.$connect(), '$connect()', 10_000).catch(
      (error: unknown) => {
        this.logger.error('Falha ao conectar no PostgreSQL (Prisma).', error);
        throw error;
      },
    );
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
    console.log('[boot] isHealthy: chamando $queryRaw...');
    try {
      await this.withTimeout(
        () => this.$queryRaw`SELECT 1`,
        '$queryRaw',
        8_000,
      );
    } catch (error) {
      console.error('[boot] isHealthy: $queryRaw falhou/timeout:', error);
      throw error;
    }

    console.log('[boot] isHealthy: $queryRaw retornou.');
    return true;
  }

  /**
   * CHOKEPOINT ÚNICO DE TENANT-SCOPING (CL-BE-01).
   *
   * Abre uma transação, publica o tenant corrente no banco e entrega ao
   * callback um client em que os models de `CLUBE_SCOPED_MODELS` já saem
   * filtrados/carimbados por `clubeId`. Toda operação de negócio escopada
   * por clube deve nascer aqui.
   *
   * DUAS CAMADAS, DE PROPÓSITO (defesa em profundidade):
   *
   * 1. `SELECT set_config('app.current_clube_id', $1, true)` é a PRIMEIRA
   *    instrução da transação. É o que as políticas de Row Level Security
   *    (CL-DB-03) leem. `set_config` como FUNÇÃO com bind parameter, nunca
   *    `SET LOCAL app.current_clube_id = '...'`: o protocolo estendido do
   *    Postgres não aceita parâmetro bindado em `SET`, então `SET LOCAL`
   *    obrigaria a concatenar `clubeId` na string SQL — uma injeção de SQL
   *    esperando acontecer. O terceiro argumento `true` faz o efeito ser
   *    `LOCAL`: dura só até o fim desta transação.
   * 2. A extension do Prisma, que injeta `where: { clubeId }` em
   *    findMany/findFirst/findUnique/count/update/updateMany/delete/deleteMany
   *    e `data: { clubeId }` em create/createMany.
   *
   * O QUE ESTA EXTENSION **NÃO** COBRE (e por que está tudo bem):
   *
   * - `$queryRaw`/`$executeRaw` chamados pelo consumidor da transação NÃO
   *   passam pela extension — só métodos do client tipado passam (verificado
   *   contra o Prisma 6.19). Eles passam, sim, pelo RLS do Postgres, que já
   *   está armado pelo `set_config` acima. É exatamente a defesa em
   *   profundidade pretendida: o SQL cru é filtrado pelo banco, não pelo
   *   ORM. Vale para `WalletService.applyLedgerEntry`, cujo
   *   `SELECT ... FOR UPDATE` é raw.
   * - Models filhos sem `clubeId` próprio (`WalletTransaction`, `PixCharge`,
   *   `StackMovement`, `TournamentTable`, ...) não são scoped automaticamente:
   *   não têm coluna para filtrar. O isolamento deles vem de (a) serem sempre
   *   acessados via FK de um pai já filtrado e (b) da política de RLS que
   *   cobre a tabela filha via `EXISTS` no pai (escopo de CL-DB-03).
   *
   * SEM `AsyncLocalStorage`: `clubeId` é parâmetro explícito de quem chama
   * `withClube`, do mesmo jeito que `userId` já é hoje em vários services.
   * Decisão deliberada — um contexto implícito seria mais uma coisa que pode
   * estar vazia em background job/consumer de fila, e o modo de falha aí é
   * silencioso demais para um controle de isolamento.
   *
   * NOTA DE IMPLEMENTAÇÃO: a extension é aplicada ao client ANTES de abrir a
   * transação, e não sobre o `tx`. Não é preferência: o client de transação
   * do Prisma remove `$extends` em runtime (`denylist` de `ITXClientDenyList`),
   * então `tx.$extends` é `undefined`. Extender primeiro e transacionar depois
   * produz o mesmo efeito — o `tx` entregue ao callback herda a extension.
   *
   * @param clubeId Tenant de toda a unidade de trabalho.
   * @param fn Callback executado dentro da transação. Recebe o client já
   *   escopado; commita ao retornar, faz rollback se lançar.
   */
  withClube<T>(
    clubeId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.$extends(clubeScopeExtension(clubeId)).$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_clube_id', ${clubeId}, true)`;
        return fn(tx as unknown as Prisma.TransactionClient);
      },
    );
  }
}
