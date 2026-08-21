import {
  BadRequestException,
  Injectable,
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
import { createHmac } from 'node:crypto';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly abacatePayClient: AbacatePayClient,
  ) {}

  async getBalance(userId: string): Promise<WalletBalanceResponse> {
    const wallet = await this.findWalletOrThrow(userId);
    return toWalletBalanceResponse(wallet);
  }

  async getTransactions(
    userId: string,
    cursor: string | undefined,
    limit: number | undefined,
  ): Promise<PaginatedResponse<WalletTransactionDto>> {
    const wallet = await this.findWalletOrThrow(userId);
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
   */
  async createDeposit(
    userId: string,
    dto: CreateDepositDto,
    idempotencyKey: string,
  ): Promise<PixChargeResponse> {
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

    await this.findWalletOrThrow(userId);

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

    const charge = await this.prisma.pixCharge.create({
      data: {
        userId,
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
   */
  async requestWithdrawal(
    userId: string,
    dto: RequestWithdrawalDto,
    idempotencyKey: string,
  ): Promise<PixWithdrawalResponse> {
    const amount = new Prisma.Decimal(dto.amount);
    const limits = this.walletLimits();

    if (amount.lessThan(limits.minWithdrawal)) {
      throw new BadRequestException(
        `Valor mínimo de saque é R$ ${limits.minWithdrawal}.`,
      );
    }

    const ledgerKey = `withdrawal:${idempotencyKey}`;
    const wallet = await this.findWalletOrThrow(userId);

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
   * Processa um webhook do AbacatePay já com o corpo bruto (a assinatura é
   * calculada sobre os bytes exatos — nunca sobre um JSON re-serializado,
   * que pode divergir em espaços/ordem de chaves e invalidar o HMAC).
   *
   * NOTA: formato de assinatura/payload ainda não validado contra a doc
   * oficial do AbacatePay (mesmo estágio dos demais TODOs da integração, ver
   * `integrations/abacatepay/types.ts`) — ajustar quando disponível em sandbox.
   */
  async handleWebhook(
    rawBody: Buffer,
    signatureHeader: string | undefined,
    timestampHeader: string | undefined,
  ): Promise<void> {
    this.verifyWebhookSignature(rawBody, signatureHeader, timestampHeader);

    const event = parseWebhookEvent(rawBody);

    let webhookEvent: WebhookEvent;
    try {
      webhookEvent = await this.prisma.webhookEvent.create({
        data: {
          provider: 'abacatepay',
          externalEventId: event.externalEventId,
          eventType: event.eventType,
          signature: signatureHeader ?? '',
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

    if (event.eventType !== 'billing.paid') {
      await this.prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: { processedAt: new Date() },
      });
      return;
    }

    try {
      await this.creditDeposit(event.chargeExternalId);
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

    const wallet = await this.prisma.wallet.findUniqueOrThrow({
      where: { userId: charge.userId },
    });

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

    const currentBalance = new Prisma.Decimal(locked.balance.toString());
    const newBalance = currentBalance.add(params.amount);
    if (newBalance.isNegative()) {
      throw new UnprocessableEntityException('Saldo insuficiente.');
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

  private verifyWebhookSignature(
    rawBody: Buffer,
    signatureHeader: string | undefined,
    timestampHeader: string | undefined,
  ): void {
    const config = this.configService.get<AbacatePayConfig>('abacatePay') ?? {};
    const secret = config.webhookSecret ?? '';
    const tolerance = config.webhookToleranceSeconds ?? 300;

    if (!signatureHeader || !timestampHeader) {
      throw new UnauthorizedException('Assinatura do webhook ausente.');
    }

    const timestamp = Number(timestampHeader);
    const nowSeconds = Date.now() / 1000;
    if (
      !Number.isFinite(timestamp) ||
      Math.abs(nowSeconds - timestamp) > tolerance
    ) {
      throw new UnauthorizedException(
        'Timestamp do webhook fora da janela anti-replay.',
      );
    }

    const expected = createHmac('sha256', secret)
      .update(`${timestampHeader}.${rawBody.toString('utf8')}`)
      .digest('hex');

    if (!timingSafeEqual(expected, signatureHeader)) {
      throw new UnauthorizedException('Assinatura do webhook inválida.');
    }
  }

  private async findWalletOrThrow(userId: string): Promise<Wallet> {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) {
      throw new NotFoundException('Carteira não encontrada para este usuário.');
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

/** Shape mínimo assumido do payload do webhook — ver nota em `handleWebhook`. */
interface ParsedWebhookEvent {
  externalEventId: string;
  eventType: string;
  chargeExternalId: string;
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
  const chargeExternalId = data?.id;

  if (
    typeof externalEventId !== 'string' ||
    typeof eventType !== 'string' ||
    typeof chargeExternalId !== 'string'
  ) {
    throw new BadRequestException(
      'Payload do webhook fora do contrato esperado (id/event/data.id).',
    );
  }

  return {
    externalEventId,
    eventType,
    chargeExternalId,
    raw: body as Prisma.InputJsonValue,
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}
