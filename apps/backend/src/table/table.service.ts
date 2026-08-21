import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  PaginatedResponse,
  TableSeatDto,
  TableSummaryDto,
} from '@poker-system/shared';
import { Prisma } from '@prisma/client';
import { decodeCursor, encodeCursor } from '../common/pagination/cursor';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import type { CreateTableDto } from './dto/create-table.dto';
import type { RecordMovementDto } from './dto/record-movement.dto';
import type { SitAtTableDto } from './dto/sit-at-table.dto';
import { toSeatDto, toTableSeats, toTableSummaryDto } from './table.mappers';

const DEFAULT_PAGE_SIZE = 20;
const EMPTY_SEAT = (seatNumber: number): TableSeatDto => ({
  seatNumber,
  userId: null,
  userName: null,
  currentStack: null,
  sessionId: null,
});

@Injectable()
export class TableService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
  ) {}

  async createTable(
    adminId: string,
    dto: CreateTableDto,
  ): Promise<TableSummaryDto> {
    const minBuyIn = new Prisma.Decimal(dto.minBuyIn);
    const maxBuyIn = new Prisma.Decimal(dto.maxBuyIn);
    if (minBuyIn.greaterThan(maxBuyIn)) {
      throw new BadRequestException(
        'minBuyIn não pode ser maior que maxBuyIn.',
      );
    }

    const table = await this.prisma.table.create({
      data: {
        name: dto.name,
        type: dto.type,
        smallBlind: dto.smallBlind,
        bigBlind: dto.bigBlind,
        minBuyIn,
        maxBuyIn,
        maxSeats: dto.maxSeats,
        rakePercent: dto.rakePercent,
        status: 'OPEN',
        createdById: adminId,
      },
    });

    return toTableSummaryDto({ ...table, _count: { sessions: 0 } });
  }

  async listTables(
    cursor: string | undefined,
    limit: number | undefined,
  ): Promise<PaginatedResponse<TableSummaryDto>> {
    const pageSize = limit ?? DEFAULT_PAGE_SIZE;
    const after = cursor ? decodeCursor(cursor) : null;

    const rows = await this.prisma.table.findMany({
      where: after
        ? {
            OR: [
              { createdAt: { lt: after.createdAt } },
              { createdAt: after.createdAt, id: { lt: after.id } },
            ],
          }
        : {},
      include: {
        _count: { select: { sessions: { where: { status: 'ACTIVE' } } } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: pageSize + 1,
    });

    const hasMore = rows.length > pageSize;
    const page = hasMore ? rows.slice(0, pageSize) : rows;
    const last = page[page.length - 1];

    return {
      items: page.map(toTableSummaryDto),
      nextCursor: hasMore && last ? encodeCursor(last) : null,
    };
  }

  async getSeats(tableId: string): Promise<TableSeatDto[]> {
    const table = await this.prisma.table.findUnique({
      where: { id: tableId },
    });
    if (!table) throw new NotFoundException('Mesa não encontrada.');

    const activeSessions = await this.prisma.tableSession.findMany({
      where: { tableId, status: 'ACTIVE' },
      include: { user: { select: { id: true, name: true } } },
    });

    return toTableSeats(table.maxSeats, activeSessions);
  }

  /**
   * Buy-in: cria a `TableSession` (assento) e move o valor da Wallet para o
   * stack na MESMA transação, via `WalletService.applyLedgerEntry` — os dois
   * ledgers (wallet e stack) ficam consistentes por construção, nunca um
   * escrito sem o outro. A `TableSession` é criada ANTES do lançamento na
   * wallet: se o assento já estiver ocupado (índice único parcial) ou o
   * usuário já tiver sessão ativa na mesa, a colisão estoura cedo, sem tocar
   * a wallet.
   */
  async sitAtTable(
    userId: string,
    tableId: string,
    dto: SitAtTableDto,
    idempotencyKey: string,
  ): Promise<TableSeatDto> {
    const table = await this.prisma.table.findUnique({
      where: { id: tableId },
    });
    if (!table) throw new NotFoundException('Mesa não encontrada.');
    if (table.status !== 'OPEN') {
      throw new BadRequestException(
        'Mesa não está aberta para novos jogadores.',
      );
    }
    if (dto.seatNumber > table.maxSeats) {
      throw new BadRequestException(`Mesa só tem ${table.maxSeats} assentos.`);
    }

    const buyIn = new Prisma.Decimal(dto.buyInAmount);
    if (buyIn.lessThan(table.minBuyIn) || buyIn.greaterThan(table.maxBuyIn)) {
      throw new BadRequestException(
        `Buy-in deve estar entre ${table.minBuyIn.toFixed(2)} e ${table.maxBuyIn.toFixed(2)}.`,
      );
    }

    const ledgerKey = `buyin:${idempotencyKey}`;
    const existingTxn = await this.prisma.walletTransaction.findUnique({
      where: { idempotencyKey: ledgerKey },
    });
    if (existingTxn?.tableSessionId) {
      const existingSession = await this.prisma.tableSession.findUnique({
        where: { id: existingTxn.tableSessionId },
        include: { user: { select: { id: true, name: true } } },
      });
      if (existingSession) return toSeatDto(existingSession);
    }

    const wallet = await this.prisma.wallet.findUniqueOrThrow({
      where: { userId },
    });

    try {
      const session = await this.prisma.$transaction(async (tx) => {
        const created = await tx.tableSession.create({
          data: {
            tableId,
            userId,
            seatNumber: dto.seatNumber,
            status: 'ACTIVE',
            currentStack: 0,
            totalBuyIn: 0,
          },
        });

        const walletTxn = await this.walletService.applyLedgerEntry(
          tx,
          wallet.id,
          {
            type: 'TABLE_BUY_IN',
            amount: buyIn.negated(),
            idempotencyKey: ledgerKey,
            description: 'Buy-in em mesa',
            tableSessionId: created.id,
          },
        );

        await tx.stackMovement.create({
          data: {
            tableSessionId: created.id,
            amount: buyIn,
            reason: 'BUY_IN',
            stackAfter: buyIn,
            walletTransactionId: walletTxn.id,
          },
        });

        return tx.tableSession.update({
          where: { id: created.id },
          data: {
            currentStack: buyIn,
            totalBuyIn: buyIn,
            version: { increment: 1 },
          },
          include: { user: { select: { id: true, name: true } } },
        });
      });

      return toSeatDto(session);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException(
          'Assento já ocupado ou você já está sentado nesta mesa.',
        );
      }
      throw error;
    }
  }

  /**
   * Cash-out do stack inteiro. Lock otimista via `version` (re-lê a sessão
   * DENTRO da transação — o valor lido antes de abrir a transação poderia
   * estar desatualizado se um `recordMovement` concorrente mudou o stack).
   */
  async cashOut(
    userId: string,
    tableId: string,
    sessionId: string,
    idempotencyKey: string,
  ): Promise<TableSeatDto> {
    const ledgerKey = `cashout:${idempotencyKey}`;
    const existingTxn = await this.prisma.walletTransaction.findUnique({
      where: { idempotencyKey: ledgerKey },
    });
    if (existingTxn) {
      return EMPTY_SEAT(
        (await this.mustGetSession(tableId, sessionId)).seatNumber,
      );
    }

    const wallet = await this.prisma.wallet.findUniqueOrThrow({
      where: { userId },
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const fresh = await this.mustGetSession(tableId, sessionId);
      if (fresh.userId !== userId) {
        throw new ForbiddenException(
          'Você só pode fazer cash-out da sua própria sessão.',
        );
      }
      if (fresh.status !== 'ACTIVE') {
        throw new BadRequestException('Sessão já encerrada.');
      }

      const amount = fresh.currentStack;

      try {
        const result = await this.prisma.$transaction(async (tx) => {
          const walletTxn = await this.walletService.applyLedgerEntry(
            tx,
            wallet.id,
            {
              type: 'TABLE_CASH_OUT',
              amount,
              idempotencyKey: ledgerKey,
              description: 'Cash-out de mesa',
              tableSessionId: sessionId,
            },
          );

          const updateResult = await tx.tableSession.updateMany({
            where: { id: sessionId, version: fresh.version },
            data: {
              status: 'CASHED_OUT',
              leftAt: new Date(),
              currentStack: 0,
              totalCashOut: { increment: amount },
              version: { increment: 1 },
            },
          });
          if (updateResult.count === 0) {
            // Optimistic lock perdido (stack mudou entre a leitura e aqui) — aborta a transação e tenta de novo.
            throw new OptimisticLockError();
          }

          await tx.stackMovement.create({
            data: {
              tableSessionId: sessionId,
              amount: amount.negated(),
              reason: 'CASH_OUT',
              stackAfter: new Prisma.Decimal(0),
              walletTransactionId: walletTxn.id,
            },
          });

          return EMPTY_SEAT(fresh.seatNumber);
        });

        return result;
      } catch (error) {
        if (error instanceof OptimisticLockError) continue;
        throw error;
      }
    }

    throw new ConflictException(
      'Muita concorrência nesta sessão — tente novamente.',
    );
  }

  /** Registra HAND_RESULT/ADJUSTMENT — NUNCA cruza a wallet (ver StackMovementReason em table.prisma). */
  async recordMovement(
    adminId: string,
    tableId: string,
    sessionId: string,
    dto: RecordMovementDto,
  ): Promise<TableSeatDto> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const fresh = await this.mustGetSession(tableId, sessionId);
      if (fresh.status !== 'ACTIVE') {
        throw new BadRequestException('Sessão já encerrada.');
      }

      const amount = new Prisma.Decimal(dto.amount);
      const newStack = fresh.currentStack.add(amount);
      if (newStack.isNegative()) {
        throw new BadRequestException('Stack insuficiente para este ajuste.');
      }

      const updateResult = await this.prisma.tableSession.updateMany({
        where: { id: sessionId, version: fresh.version },
        data: { currentStack: newStack, version: { increment: 1 } },
      });
      if (updateResult.count === 0) continue;

      await this.prisma.stackMovement.create({
        data: {
          tableSessionId: sessionId,
          amount,
          reason: dto.reason,
          stackAfter: newStack,
          createdById: adminId,
        },
      });

      return toSeatDto({
        id: sessionId,
        seatNumber: fresh.seatNumber,
        currentStack: newStack,
        user: { id: fresh.userId, name: fresh.userName },
      });
    }

    throw new ConflictException(
      'Muita concorrência nesta sessão — tente novamente.',
    );
  }

  private async mustGetSession(tableId: string, sessionId: string) {
    const session = await this.prisma.tableSession.findUnique({
      where: { id: sessionId },
      include: { user: { select: { id: true, name: true } } },
    });
    if (!session || session.tableId !== tableId) {
      throw new NotFoundException('Sessão de mesa não encontrada.');
    }
    return { ...session, userName: session.user.name };
  }
}

/** Sinaliza conflito de `version` para o loop de retry — nunca escapa do método público. */
class OptimisticLockError extends Error {}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}
