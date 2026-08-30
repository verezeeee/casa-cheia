import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
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
import { Prisma, type Wallet, type WebhookEvent } from '@prisma/client';
import { timingSafeEqual } from '../common/crypto/timing-safe-equal';
import {
  AbacatePayClient,
  AbacatePayError,
  AbacatePayRequestError,
  type AbacatePayConfig,
} from '../integrations/abacatepay';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateDepositDto } from './dto/create-deposit.dto';
import type { RequestWithdrawalDto } from './dto/request-withdrawal.dto';
import {
  decodeCursor,
  encodeCursor,
  toPixChargeResponse,
  toPixWithdrawalResponse,
  toWalletBalanceResponse,
  toWalletTransactionDto,
} from './wallet.mappers';

/** Config do namespace `wallet` (ver `config/configuration.ts`). */
interface WalletLimitsConfig {
  minDeposit: string;
  maxDeposit: string;
  minWithdrawal: string;
}

const DEFAULT_PAGE_SIZE = 20;

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly abacatePayClient: AbacatePayClient,
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
   * Cria uma cobrança PIX no gateway. `idempotencyKey` vira o
   * `externalReferenceId` enviado ao AbacatePay — reapresentar a mesma chave
   * reutiliza a mesma cobrança do lado do gateway (contrato documentado em
   * `AbacatePayClient.createPixCharge`). Cache local de replay (devolver a
   * MESMA resposta sem tocar o gateway de novo) fica para o interceptor
   * genérico de idempotência da Fase 5.
   *
   * Recusa cedo (503) quando o módulo de pagamento está em standby
   * (`wallet.paymentsEnabled`, default `false`) — evita bater num gateway que
   * nem está configurado pra produção ainda enquanto o resto do sistema é
   * testado sem depender de dinheiro real (ver `applyLedgerEntry`).
   */
  async createDeposit(
    userId: string,
    clubeId: string,
    dto: CreateDepositDto,
    idempotencyKey: string,
  ): Promise<PixChargeResponse> {
    this.assertPaymentsEnabled();

    const amount = new Prisma.Decimal(dto.amount);
    const limits = this.walletLimits();

    if (amount.lessThan(limits.minDeposit)) {
      throw new BadRequestException(
        `Valor mínimo de depósito é R$ ${limits.minDeposit}.`,
      );
    }
    if (amount.greaterThan(limits.maxDeposit)) {
      throw new BadRequestException(
        `Valor máximo de depósito é R$ ${limits.maxDeposit}.`,
      );
    }

    await this.findWalletOrThrow(userId, clubeId);

    let result: Awaited<ReturnType<AbacatePayClient['createPixCharge']>>;
    try {
      result = await this.abacatePayClient.createPixCharge({
        amount: dto.amount,
        externalReferenceId: `deposit:${idempotencyKey}`,
        description: 'Depósito - Poker System',
      });
    } catch (error) {
      // Nenhuma reserva de saldo acontece na criação do depósito (só o
      // webhook credita) — diferente do saque, não há nada para estornar
      // aqui. Só traduz a falha do gateway (`AbacatePayError`) num erro
      // HTTP com sentido em vez de deixá-la virar 500 opaco.
      if (error instanceof AbacatePayError) {
        throw new ServiceUnavailableException(
          'Não foi possível gerar o PIX agora. Tente novamente em instantes.',
        );
      }
      throw error;
    }

    // Sem valor nem dado de cliente no log — só o id do gateway, para
    // correlacionar com o painel do AbacatePay/suporte ao investigar um
    // depósito específico.
    this.logger.log(
      `[createDeposit] usuário ${userId} — PIX ${result.externalId} criado no gateway.`,
    );

    const charge = await this.prisma.pixCharge.create({
      data: {
        userId,
        clubeId,
        externalId: result.externalId,
        amount,
        status: 'PENDING',
        qrCodePayload: result.brCode ?? '',
        qrCodeImageUrl: result.brCodeBase64 ?? null,
        expiresAt: result.expiresAt
          ? new Date(result.expiresAt)
          : addMinutes(new Date(), 30),
        rawPayload: result as unknown as Prisma.InputJsonValue,
      },
    });

    return toPixChargeResponse(charge);
  }

  /**
   * Solicita um saque PIX. O débito acontece AGORA (reserva do valor, sob
   * lock pessimista) — ver `PixWithdrawalStatus.REQUESTED` — antes de
   * qualquer chamada ao gateway, para que o saldo não possa ser gasto em
   * paralelo enquanto o saque está em voo.
   *
   * Recusa cedo (503) em standby — mesma nota de `createDeposit`.
   */
  async requestWithdrawal(
    userId: string,
    clubeId: string,
    dto: RequestWithdrawalDto,
    idempotencyKey: string,
  ): Promise<PixWithdrawalResponse> {
    this.assertPaymentsEnabled();

    const amount = new Prisma.Decimal(dto.amount);
    const limits = this.walletLimits();

    if (amount.lessThan(limits.minWithdrawal)) {
      throw new BadRequestException(
        `Valor mínimo de saque é R$ ${limits.minWithdrawal}.`,
      );
    }

    const ledgerKey = `withdrawal:${idempotencyKey}`;
    const wallet = await this.findWalletOrThrow(userId, clubeId);

    const existing = await this.prisma.walletTransaction.findUnique({
      where: { idempotencyKey: ledgerKey },
    });
    if (existing) {
      const previous = await this.prisma.pixWithdrawal.findFirst({
        where: { walletTransactions: { some: { id: existing.id } } },
      });
      if (previous) return toPixWithdrawalResponse(previous);
    }

    const withdrawal = await this.prisma.$transaction(async (tx) => {
      await this.applyLedgerEntry(tx, wallet.id, {
        type: 'PIX_WITHDRAWAL',
        amount: amount.negated(),
        idempotencyKey: ledgerKey,
        description: 'Saque PIX',
      });

      return tx.pixWithdrawal.create({
        data: {
          userId,
          clubeId,
          amount,
          pixKey: dto.pixKey,
          pixKeyType: dto.pixKeyType,
          status: 'REQUESTED',
        },
      });
    });

    try {
      const result = await this.abacatePayClient.requestPixWithdrawal({
        amount: dto.amount,
        pixKey: dto.pixKey,
        pixKeyType: dto.pixKeyType,
        externalReferenceId: withdrawal.id,
      });

      const updated = await this.prisma.pixWithdrawal.update({
        where: { id: withdrawal.id },
        data: { externalId: result.externalId, status: 'PROCESSING' },
      });
      return toPixWithdrawalResponse(updated);
    } catch (error) {
      if (error instanceof AbacatePayRequestError) {
        // Falha DEFINITIVA (4xx) do gateway: o saque não foi aceito, então
        // o débito reservado é estornado por um lançamento inverso — o
        // lançamento original (`ledgerKey`) NUNCA é editado (ledger append-only).
        const updated = await this.prisma.$transaction(async (tx) => {
          await this.applyLedgerEntry(tx, wallet.id, {
            type: 'PIX_WITHDRAWAL',
            amount,
            idempotencyKey: `${ledgerKey}:reversal`,
            description: 'Estorno de saque PIX recusado pelo gateway',
          });
          return tx.pixWithdrawal.update({
            where: { id: withdrawal.id },
            data: { status: 'FAILED', failureReason: error.message },
          });
        });
        return toPixWithdrawalResponse(updated);
      }

      // AbacatePayUnavailableError (timeout/rede/5xx): resultado
      // INDETERMINADO no gateway — NÃO estorna (poderia já ter sido aceito
      // do outro lado). Fica REQUESTED para reconciliação manual/job futuro.
      throw new ServiceUnavailableException(
        'Não foi possível confirmar o saque agora; ele será reconciliado em breve.',
      );
    }
  }

  /**
   * Processa um webhook do AbacatePay já com o corpo bruto.
   *
   * CONFIRMADO CONTRA UMA ENTREGA REAL (23/08/2026, `transparent.completed`,
   * dev mode — ver `AbacatePayConfig` em `integrations/abacatepay/types.ts`
   * para o payload completo). Duas coisas que a versão anterior deste
   * método adivinhava ERRADO, agora corrigidas:
   *
   * 1. Auth não é HMAC. O AbacatePay manda o segredo configurado NO
   *    WEBHOOK, em texto puro, no header `X-Webhook-Secret` (com fallback
   *    na query string `?webhookSecret=...` — mesmo valor, redundante,
   *    provavelmente para proxies que descartam headers custom). Não há
   *    timestamp nem janela anti-replay: a proteção contra replay vem só
   *    do dedup por `externalEventId` abaixo (`@@unique([provider,
   *    externalEventId])`) — um webhook capturado e reenviado é um no-op,
   *    não chega a reprocessar, mas também não é rejeitado por "idade".
   *    Existe também um `X-Webhook-Signature` (aparenta HMAC/base64) que
   *    este service NÃO verifica — o secret em texto puro já autentica a
   *    origem, e adicionar uma segunda verificação cujo algoritmo não está
   *    documentado só arriscaria rejeitar webhooks legítimos por engano.
   * 2. O id do recurso não é `data.id` — é `data.<recurso>.id`, onde
   *    `<recurso>` é o primeiro segmento de `event` antes do ponto
   *    (`transparent` em `transparent.completed`). Ver `parseWebhookEvent`.
   *
   * `transfer.completed`/`transfer.failed` (reconciliação de saque) ainda
   * NÃO foram vistos numa entrega real — só `transparent.completed`. O
   * nome do evento é a melhor hipótese contra o enum do AbacatePay v2 (não
   * há um evento `pix.*`/`transaction.*`; `payout.*` é o outro par do
   * enum, mas cobre `createPayout` — saldo para chave PIX da PRÓPRIA loja,
   * fluxo que este service não expõe). Ajustar `webhookProcessors()` e
   * `parseWebhookEvent` se uma entrega real divergir.
   *
   * RESOLUÇÃO DE CLUBE (CL-BE-07): este endpoint continua PÚBLICO e SEM
   * `:clubeId` na rota — o payload do AbacatePay não carrega o clube, e não
   * há como exigir isso do gateway. O que mudou é que `creditDeposit` e
   * `failWithdrawal` não precisam mais adivinhar a wallet certa a partir de
   * só `userId`: `PixCharge`/`PixWithdrawal` agora guardam `clubeId` desde a
   * criação (`createDeposit`/`requestWithdrawal`), então o clube é lido do
   * próprio registro pelo `externalId` do webhook, não do request HTTP.
   */
  async handleWebhook(
    rawBody: Buffer,
    secretHeader: string | undefined,
    secretQuery: string | undefined,
  ): Promise<void> {
    this.verifyWebhookSecret(secretHeader, secretQuery);

    const event = parseWebhookEvent(rawBody);

    let webhookEvent: WebhookEvent;
    try {
      webhookEvent = await this.prisma.webhookEvent.create({
        data: {
          provider: 'abacatepay',
          externalEventId: event.externalEventId,
          eventType: event.eventType,
          // Coluna nasceu para uma assinatura HMAC; hoje guarda o secret
          // recebido (header ou query), só como trilha auditável de
          // "o que provou a origem desta requisição" — não é mais um
          // segredo que precise ficar oculto (é o mesmo valor configurado
          // em `ABACATEPAY_WEBHOOK_SECRET`, já em texto puro no request).
          signature: secretHeader ?? secretQuery ?? '',
          payload: event.raw,
        },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        // `@@unique([provider, externalEventId])`: o provedor reenviou um
        // evento já processado — no-op idempotente (decisão D-04).
        return;
      }
      throw error;
    }

    const processEvent = this.webhookProcessors()[event.eventType];
    if (!processEvent) {
      await this.prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: { processedAt: new Date() },
      });
      return;
    }

    try {
      await processEvent(event.dataId);
      await this.prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: { processedAt: new Date() },
      });
    } catch (error) {
      await this.prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: {
          error: error instanceof Error ? error.message : 'erro desconhecido',
        },
      });
      throw error;
    }
  }

  /** Dispatch de `event.eventType` → handler. Ver nota em `handleWebhook`. */
  private webhookProcessors(): Record<
    string,
    ((dataId: string) => Promise<void>) | undefined
  > {
    return {
      'transparent.completed': (dataId) => this.creditDeposit(dataId),
      'transfer.completed': (dataId) => this.completeWithdrawal(dataId),
      'transfer.failed': (dataId) =>
        this.failWithdrawal(dataId, 'Transferência recusada pelo gateway.'),
    };
  }

  private async creditDeposit(chargeExternalId: string): Promise<void> {
    const charge = await this.prisma.pixCharge.findUnique({
      where: { externalId: chargeExternalId },
    });
    if (!charge) {
      throw new NotFoundException(
        `PixCharge não encontrada: ${chargeExternalId}.`,
      );
    }
    // Defesa redundante ao unique de WebhookEvent: um evento duplicado que
    // por algum motivo escapasse da dedução acima ainda não duplicaria o crédito.
    if (charge.status === 'PAID') return;

    // `PixCharge.clubeId` (CL-BE-07) resolve a wallet certa pela chave
    // composta — sem ambiguidade mesmo que o jogador tenha carteira em mais
    // de um clube.
    const wallet = await this.findWalletOrThrow(charge.userId, charge.clubeId);

    await this.prisma.$transaction(async (tx) => {
      await this.applyLedgerEntry(tx, wallet.id, {
        type: 'PIX_DEPOSIT',
        amount: charge.amount,
        idempotencyKey: `deposit-credit:${charge.id}`,
        description: 'Depósito PIX confirmado',
        pixChargeId: charge.id,
      });
      await tx.pixCharge.update({
        where: { id: charge.id },
        data: { status: 'PAID', paidAt: new Date() },
      });
    });
  }

  /**
   * Saque que o gateway concluiu — só atualiza status/`processedAt`. O
   * saldo já foi debitado (reservado) em `requestWithdrawal`, na hora do
   * pedido; sucesso na entrega não move dinheiro de novo.
   */
  private async completeWithdrawal(externalId: string): Promise<void> {
    const withdrawal = await this.prisma.pixWithdrawal.findUnique({
      where: { externalId },
    });
    if (!withdrawal) {
      throw new NotFoundException(
        `PixWithdrawal não encontrado: ${externalId}.`,
      );
    }
    // Defesa redundante ao dedup de WebhookEvent: evita reprocessar um
    // saque que já saiu de PROCESSING.
    if (withdrawal.status !== 'PROCESSING') return;

    await this.prisma.pixWithdrawal.update({
      where: { id: withdrawal.id },
      data: { status: 'COMPLETED', processedAt: new Date() },
    });
  }

  /**
   * Saque que o gateway aceitou (`PROCESSING`) e depois falhou de forma
   * assíncrona — diferente da falha SÍNCRONA em `requestWithdrawal` (4xx
   * imediato, já estornada ali). Aqui o valor já estava reservado desde o
   * pedido e precisa voltar agora. Lançamento inverso, nunca edita o débito
   * original (ledger append-only) — mesmo padrão da falha síncrona.
   */
  private async failWithdrawal(
    externalId: string,
    reason: string,
  ): Promise<void> {
    const withdrawal = await this.prisma.pixWithdrawal.findUnique({
      where: { externalId },
    });
    if (!withdrawal) {
      throw new NotFoundException(
        `PixWithdrawal não encontrado: ${externalId}.`,
      );
    }
    if (withdrawal.status !== 'PROCESSING') return;

    // `PixWithdrawal.clubeId` (CL-BE-07) — mesma resolução de `creditDeposit`.
    const wallet = await this.findWalletOrThrow(
      withdrawal.userId,
      withdrawal.clubeId,
    );

    await this.prisma.$transaction(async (tx) => {
      await this.applyLedgerEntry(tx, wallet.id, {
        type: 'PIX_WITHDRAWAL',
        amount: withdrawal.amount,
        idempotencyKey: `withdrawal-webhook-reversal:${withdrawal.id}`,
        description: 'Estorno de saque PIX falhado após aceite do gateway',
      });
      await tx.pixWithdrawal.update({
        where: { id: withdrawal.id },
        data: {
          status: 'FAILED',
          failureReason: reason,
          processedAt: new Date(),
        },
      });
    });
  }

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

  /** Guarda de entrada de `createDeposit`/`requestWithdrawal` — nada de gateway em standby. */
  private assertPaymentsEnabled(): void {
    if (!this.paymentsEnabled()) {
      throw new ServiceUnavailableException(
        'Pagamentos estão em standby por enquanto — depósitos e saques ficam indisponíveis.',
      );
    }
  }

  /**
   * O AbacatePay não assina o corpo — manda o segredo configurado no
   * webhook em texto puro (header, com a query string como fallback; ver
   * docblock de `handleWebhook`). Comparação em tempo constante mesmo
   * assim: é uma igualdade de segredo, o mesmo raciocínio de qualquer
   * comparação de token/senha.
   */
  private verifyWebhookSecret(
    secretHeader: string | undefined,
    secretQuery: string | undefined,
  ): void {
    const config = this.configService.get<AbacatePayConfig>('abacatePay') ?? {};
    const configured = config.webhookSecret ?? '';
    const provided = secretHeader ?? secretQuery;

    if (!provided) {
      throw new UnauthorizedException('Secret do webhook ausente.');
    }
    if (!timingSafeEqual(configured, provided)) {
      throw new UnauthorizedException('Secret do webhook inválido.');
    }
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

  private walletLimits(): WalletLimitsConfig {
    return (
      this.configService.get<WalletLimitsConfig>('wallet') ?? {
        minDeposit: '10.00',
        maxDeposit: '50000.00',
        minWithdrawal: '10.00',
      }
    );
  }
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

/**
 * Shape do payload do webhook — CONFIRMADO contra uma entrega real de
 * `transparent.completed` (ver docblock de `handleWebhook`):
 * `{id, event, apiVersion, devMode, data: {transparent: {id, ...}, ...}}`.
 * `dataId` é o id da entidade afetada — `data.transparent.id` para
 * `transparent.*`, por inferência `data.transfer.id` para `transfer.*`
 * (mesmo padrão `data.<recurso>.id`, onde `<recurso>` é o primeiro
 * segmento de `event` antes do ponto — não confirmado por entrega real).
 */
interface ParsedWebhookEvent {
  externalEventId: string;
  eventType: string;
  dataId: string;
  raw: Prisma.InputJsonValue;
}

function parseWebhookEvent(rawBody: Buffer): ParsedWebhookEvent {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new BadRequestException('Corpo do webhook não é um JSON válido.');
  }

  const externalEventId = body.id;
  const eventType = body.event;
  const data = body.data as Record<string, unknown> | undefined;
  // `<recurso>` = primeiro segmento de `eventType` ("transparent" de
  // "transparent.completed"). Ver docblock da interface acima.
  const resource =
    typeof eventType === 'string' ? eventType.split('.')[0] : undefined;
  const resourceData = resource
    ? (data?.[resource] as Record<string, unknown> | undefined)
    : undefined;
  const dataId = resourceData?.id;

  if (
    typeof externalEventId !== 'string' ||
    typeof eventType !== 'string' ||
    typeof dataId !== 'string'
  ) {
    throw new BadRequestException(
      'Payload do webhook fora do contrato esperado (id/event/data.<recurso>.id).',
    );
  }

  return {
    externalEventId,
    eventType,
    dataId,
    raw: body as Prisma.InputJsonValue,
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}
