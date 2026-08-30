import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  PaginatedResponse,
  PixChargeResponse,
  PixWithdrawalResponse,
  WalletBalanceResponse,
  WalletTransactionDto,
} from '@poker-system/shared';
import { Prisma, type Wallet } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateDepositDto } from './dto/create-deposit.dto';
import type { RequestWithdrawalDto } from './dto/request-withdrawal.dto';
import {
  decodeCursor,
  encodeCursor,
  toWalletBalanceResponse,
  toWalletTransactionDto,
} from './wallet.mappers';

const DEFAULT_PAGE_SIZE = 20;

/** Gateway PIX (AbacatePay) desligado — ver docblock de `createDeposit`. */
const GATEWAY_STANDBY_MESSAGE =
  'Depósitos e saques via PIX estão desativados — o gateway (AbacatePay) foi retirado de operação por enquanto.';

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async getBalance(
    userId: string,
    clubeId: string,
  ): Promise<WalletBalanceResponse> {
    const wallet = await this.findWalletOrThrow(userId, clubeId);
    return toWalletBalanceResponse(wallet);
  }

  async getTransactions(
    userId: string,
    clubeId: string,
    cursor: string | undefined,
    limit: number | undefined,
  ): Promise<PaginatedResponse<WalletTransactionDto>> {
    const wallet = await this.findWalletOrThrow(userId, clubeId);
    const pageSize = limit ?? DEFAULT_PAGE_SIZE;
    const after = cursor ? decodeCursor(cursor) : null;

    // Keyset por (createdAt, id) — o índice `[walletId, createdAt DESC]` já
    // existe no schema; `id` desempata linhas com o mesmo `createdAt`.
    const rows = await this.prisma.walletTransaction.findMany({
      where: {
        walletId: wallet.id,
        ...(after
          ? {
              OR: [
                { createdAt: { lt: after.createdAt } },
                { createdAt: after.createdAt, id: { lt: after.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: pageSize + 1,
    });

    const hasMore = rows.length > pageSize;
    const page = hasMore ? rows.slice(0, pageSize) : rows;
    const last = page[page.length - 1];

    return {
      items: page.map(toWalletTransactionDto),
      nextCursor: hasMore && last ? encodeCursor(last) : null,
    };
  }

  /**
   * GATEWAY EM STANDBY — a integração real com o AbacatePay (cliente HTTP,
   * webhook, credenciais) foi desconectada do módulo por tempo
   * indeterminado ("resolvemos com o gateway depois"). Este método (e
   * `requestWithdrawal`/`handleWebhook`) agora só recusa; a implementação
   * original que criava a cobrança PIX de verdade está preservada no
   * histórico do git (ver o commit que introduziu este stub) — reativar é
   * restaurá-la e voltar a importar `AbacatePayModule` em `wallet.module.ts`.
   *
   * A carteira interna (saldo/ledger, `applyLedgerEntry`) NÃO foi afetada —
   * continua sustentando buy-in/reembolso de mesa e torneio normalmente.
   */
  /* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/require-await --
     assinaturas preservadas de propósito (contrato de `WalletController`/testes) — stubs
     sem I/O, os parâmetros originais ficam documentando o que a implementação real recebia. */
  async createDeposit(
    userId: string,
    clubeId: string,
    dto: CreateDepositDto,
    idempotencyKey: string,
  ): Promise<PixChargeResponse> {
    throw new ServiceUnavailableException(GATEWAY_STANDBY_MESSAGE);
  }

  /** Gateway em standby — ver docblock de `createDeposit`. */
  async requestWithdrawal(
    userId: string,
    clubeId: string,
    dto: RequestWithdrawalDto,
    idempotencyKey: string,
  ): Promise<PixWithdrawalResponse> {
    throw new ServiceUnavailableException(GATEWAY_STANDBY_MESSAGE);
  }

  /** Gateway em standby — ver docblock de `createDeposit`. */
  async handleWebhook(
    rawBody: Buffer,
    secretHeader: string | undefined,
    secretQuery: string | undefined,
  ): Promise<void> {
    throw new ServiceUnavailableException(GATEWAY_STANDBY_MESSAGE);
  }
  /* eslint-enable @typescript-eslint/no-unused-vars, @typescript-eslint/require-await */

  /**
   * Único ponto de escrita no ledger da wallet (decisões D-02/D-03 de
   * `base.prisma`): lock pessimista na linha da wallet via `SELECT ... FOR
   * UPDATE`, cálculo do novo saldo em `Decimal`, `CHECK (balance >= 0)` como
   * última barreira do banco. `amount` já vem com sinal (positivo = crédito,
   * negativo = débito). SEMPRE chamado dentro de um `prisma.$transaction`.
   *
   * PÚBLICO de propósito: é o único ponto de escrita no ledger da wallet do
   * sistema inteiro — outros módulos que precisam mover dinheiro (Table,
   * Tournament) chamam este método dentro da PRÓPRIA transação, em vez de
   * duplicar o lock/CHECK/cálculo de saldo. Sempre requer um `tx` já aberto:
   * nunca abre transação própria, para poder compor com a escrita do
   * chamador (ex.: `TableSession` + `StackMovement` do buy-in) atomicamente.
   *
   * PAGAMENTOS EM STANDBY (`wallet.paymentsEnabled`, default `false` — ver
   * `env.validation.ts`): sendo o ÚNICO chokepoint, é o único lugar que
   * precisa saber disso — `TableService`/`TournamentService` continuam
   * chamando este método exatamente como sempre chamaram, sem saber que o
   * saldo está sendo "emprestado". Quando um débito estouraria o saldo E o
   * módulo está em standby, em vez de recusar por saldo insuficiente, grava
   * um `ADJUSTMENT` cobrindo exatamente a diferença ANTES do débito — nunca
   * um saldo negativo de verdade (violaria o `CHECK (balance >= 0)`) nem um
   * desvio da invariante SUM(wallet_transactions.amount) == wallets.balance:
   * o "dinheiro de teste" é um lançamento real e rastreável, só com um motivo
   * que deixa claro que não é depósito de verdade. Com `paymentsEnabled:
   * true` (produção), o comportamento é IDÊNTICO ao de sempre — 422 de saldo
   * insuficiente.
   *
   * ESCOPO DE CLUBE (CL-BE-04): recebe `walletId`, não `userId` — o chamador
   * já resolveu a wallet certa via `(userId, clubeId)` antes de chegar aqui,
   * então este método não precisa saber de clube. O `SELECT ... FOR UPDATE`
   * abaixo é cru (sem filtro de tenant), mas quando RLS entrar em produção
   * (CL-DB-03, em paralelo) o Postgres vai filtrar essa leitura por clube
   * sozinho, pela sessão/role da conexão — defesa em profundidade "de graça",
   * sem precisar tocar este código de novo.
   */
  async applyLedgerEntry(
    tx: Prisma.TransactionClient,
    walletId: string,
    params: {
      type: Prisma.WalletTransactionCreateInput['type'];
      amount: Prisma.Decimal;
      idempotencyKey: string;
      description?: string;
      pixChargeId?: string;
      tableSessionId?: string;
      tournamentEntryId?: string;
      createdById?: string;
    },
  ) {
    const rows = await tx.$queryRaw<
      Array<{ id: string; balance: Prisma.Decimal }>
    >`
      SELECT id, balance FROM wallets WHERE id = ${walletId} FOR UPDATE
    `;
    const locked = rows[0];
    if (!locked) {
      throw new NotFoundException('Carteira não encontrada.');
    }

    let currentBalance = new Prisma.Decimal(locked.balance.toString());
    let newBalance = currentBalance.add(params.amount);

    if (newBalance.isNegative()) {
      if (this.paymentsEnabled()) {
        throw new UnprocessableEntityException('Saldo insuficiente.');
      }

      // Standby: cobre a diferença com um ADJUSTMENT real antes do débito —
      // nunca pula direto pra um saldo negativo (ver docblock do método).
      const shortfall = newBalance.negated();
      const balanceAfterTopUp = currentBalance.add(shortfall);
      await tx.walletTransaction.create({
        data: {
          walletId,
          type: 'ADJUSTMENT',
          status: 'COMPLETED',
          amount: shortfall,
          balanceAfter: balanceAfterTopUp,
          idempotencyKey: `standby-topup:${params.idempotencyKey}`,
          description: 'Ajuste automático — pagamentos em standby',
        },
      });
      currentBalance = balanceAfterTopUp;
      newBalance = currentBalance.add(params.amount);
    }

    const transaction = await tx.walletTransaction.create({
      data: {
        walletId,
        type: params.type,
        status: 'COMPLETED',
        amount: params.amount,
        balanceAfter: newBalance,
        idempotencyKey: params.idempotencyKey,
        description: params.description,
        pixChargeId: params.pixChargeId,
        tableSessionId: params.tableSessionId,
        tournamentEntryId: params.tournamentEntryId,
        createdById: params.createdById,
      },
    });

    await tx.wallet.update({
      where: { id: walletId },
      data: { balance: newBalance, version: { increment: 1 } },
    });

    return transaction;
  }

  /** `wallet.paymentsEnabled` — default `false` (standby). Ver `env.validation.ts`. */
  private paymentsEnabled(): boolean {
    return (
      this.configService.get<{ paymentsEnabled?: boolean }>('wallet')
        ?.paymentsEnabled ?? false
    );
  }

  private async findWalletOrThrow(
    userId: string,
    clubeId: string,
  ): Promise<Wallet> {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId_clubeId: { userId, clubeId } },
    });
    if (!wallet) {
      throw new NotFoundException(
        'Carteira não encontrada para este usuário neste clube.',
      );
    }
    return wallet;
  }
}
