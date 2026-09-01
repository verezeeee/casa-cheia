import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  PaginatedResponse,
  TableCloseResultDto,
  TableSeatDto,
  TableSummaryDto,
} from '@poker-system/shared';
import { randomBytes } from 'node:crypto';
import { Prisma } from '../generated/prisma';
import { mapUniqueConstraintError, normalizeEmail } from '../auth/auth.service';
import { decodeCursor, encodeCursor } from '../common/pagination/cursor';
import { PasswordHasherService } from '../common/crypto/password-hasher.service';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import type { CreateTableDto } from './dto/create-table.dto';
import type { RebuyDto } from './dto/rebuy.dto';
import type { RecordMovementDto } from './dto/record-movement.dto';
import type { SitAtTableDto } from './dto/sit-at-table.dto';
import type { SitGuestAtTableDto } from './dto/sit-guest-at-table.dto';
import {
  toSeatDto,
  toTableCloseReport,
  toTableSeats,
  toTableSummaryDto,
} from './table.mappers';

/** Senha descartável do convidado: nunca loga, só precisa satisfazer o hash. Mesmo formato de `ClubService.generateTemporaryPassword`. */
function generateThrowawayPassword(): string {
  return randomBytes(9).toString('base64url');
}

/** E-mail sintético do convidado — só existe pra satisfazer `User.email @unique`; nunca é entregável nem exibido como contato real. */
function generateGuestEmail(): string {
  return normalizeEmail(
    `convidado+${randomBytes(12).toString('hex')}@guests.invalid`,
  );
}

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
    private readonly passwordHasher: PasswordHasherService,
  ) {}

  /** `Table` é model escopado por `withClube` — `clubeId` é carimbado no `data` automaticamente. */
  async createTable(
    adminId: string,
    clubeId: string,
    dto: CreateTableDto,
  ): Promise<TableSummaryDto> {
    const minBuyIn = new Prisma.Decimal(dto.minBuyIn);
    const maxBuyIn = new Prisma.Decimal(dto.maxBuyIn);
    if (minBuyIn.greaterThan(maxBuyIn)) {
      throw new BadRequestException(
        'minBuyIn não pode ser maior que maxBuyIn.',
      );
    }

    const table = await this.prisma.withClube(clubeId, (tx) =>
      tx.table.create({
        data: {
          clubeId,
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
      }),
    );

    return toTableSummaryDto({ ...table, _count: { sessions: 0 } });
  }

  async listTables(
    clubeId: string,
    cursor: string | undefined,
    limit: number | undefined,
  ): Promise<PaginatedResponse<TableSummaryDto>> {
    const pageSize = limit ?? DEFAULT_PAGE_SIZE;
    const after = cursor ? decodeCursor(cursor) : null;

    const rows = await this.prisma.table.findMany({
      where: {
        clubeId,
        ...(after
          ? {
              OR: [
                { createdAt: { lt: after.createdAt } },
                { createdAt: after.createdAt, id: { lt: after.id } },
              ],
            }
          : {}),
      },
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

  /** Mesma forma de `listTables`, mas pra uma única mesa — usada pela tela de detalhes pra saber o `status` atual (ex: esconder "Fechar mesa" se já fechada). */
  async getTable(clubeId: string, tableId: string): Promise<TableSummaryDto> {
    const table = await this.prisma.table.findUnique({
      where: { id: tableId },
      include: {
        _count: { select: { sessions: { where: { status: 'ACTIVE' } } } },
      },
    });
    if (!table || table.clubeId !== clubeId) {
      throw new NotFoundException('Mesa não encontrada.');
    }

    return toTableSummaryDto(table);
  }

  async getSeats(clubeId: string, tableId: string): Promise<TableSeatDto[]> {
    const table = await this.prisma.table.findUnique({
      where: { id: tableId },
    });
    if (!table || table.clubeId !== clubeId) {
      throw new NotFoundException('Mesa não encontrada.');
    }

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
    clubeId: string,
    tableId: string,
    dto: SitAtTableDto,
    idempotencyKey: string,
  ): Promise<TableSeatDto> {
    const table = await this.prisma.table.findUnique({
      where: { id: tableId },
    });
    if (!table || table.clubeId !== clubeId) {
      throw new NotFoundException('Mesa não encontrada.');
    }
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
      if (existingSession && existingSession.clubeId === clubeId) {
        return toSeatDto(existingSession);
      }
    }

    const wallet = await this.prisma.wallet.findUniqueOrThrow({
      where: { userId_clubeId: { userId, clubeId } },
    });

    try {
      const session = await this.prisma.withClube(clubeId, async (tx) => {
        const created = await tx.tableSession.create({
          data: {
            clubeId,
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
   * ADMIN sentando outro membro do clube (já cadastrado) — mesma regra de
   * negócio e mesmo `sitAtTable`, só muda de qual carteira sai o buy-in
   * (`userId` da rota, não `user.id` do token). Diferente do torneio
   * (`TournamentService.registerEntry`), aqui confere explicitamente que o
   * alvo tem vínculo `ACTIVE` neste clube ANTES de tocar a wallet dele —
   * sem isso, um `userId` de outro clube ou já `REVOKED` só falharia (ou
   * não) por acidente, dependendo de existir ou não uma `Wallet` sua aqui.
   */
  async sitAtTableForUser(
    clubeId: string,
    tableId: string,
    userId: string,
    dto: SitAtTableDto,
    idempotencyKey: string,
  ): Promise<TableSeatDto> {
    await this.assertActiveMember(clubeId, userId);
    return this.sitAtTable(userId, clubeId, tableId, dto, idempotencyKey);
  }

  /**
   * ADMIN sentando um jogador SEM CADASTRO (walk-in) — só nome e telefone.
   * Cria uma conta `User` mínima (e-mail sintético, `isGuest: true`) +
   * `ClubeMembership` (`PLAYER`/`ACTIVE`) + `Wallet` (nasce zerada) e senta
   * na mesma transação do buy-in — se qualquer passo falhar (ex.: assento
   * já ocupado), NADA commita, então não sobra convidado órfão sem assento.
   *
   * DINHEIRO: o convidado nunca fez PIX, a wallet dele nasce zerada. O
   * dinheiro físico entregue no balcão entra como um `ADJUSTMENT` explícito
   * (crédito, `createdById: adminId`) imediatamente antes do débito
   * `TABLE_BUY_IN` de sempre — dois lançamentos que se cancelam, mas deixam
   * rastro de auditoria honesto ("entrada em espécie, lançada por este
   * admin") e funcionam independente de `wallet.paymentsEnabled`. Não usar
   * o fallback de "saldo insuficiente" do `WalletService.applyLedgerEntry`
   * pra isso: aquele mecanismo é rotulado como dinheiro de TESTE (só existe
   * enquanto o PIX está em standby) — usá-lo pra dinheiro real de um cliente
   * quebraria silenciosamente no dia em que o PIX for religado.
   */
  async sitGuestAtTable(
    adminId: string,
    clubeId: string,
    tableId: string,
    dto: SitGuestAtTableDto,
    idempotencyKey: string,
  ): Promise<TableSeatDto> {
    const table = await this.prisma.table.findUnique({
      where: { id: tableId },
    });
    if (!table || table.clubeId !== clubeId) {
      throw new NotFoundException('Mesa não encontrada.');
    }
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
      if (existingSession && existingSession.clubeId === clubeId) {
        return toSeatDto(existingSession);
      }
    }

    // Hash calculado ANTES da transação — não segurar a transação aberta
    // durante um `await` de argon2id (mesmo cuidado de
    // `ClubService.createMemberWithNewUser`).
    const passwordHash = await this.passwordHasher.hash(
      generateThrowawayPassword(),
    );

    try {
      const session = await this.prisma.withClube(clubeId, async (tx) => {
        const guest = await tx.user.create({
          data: {
            email: generateGuestEmail(),
            passwordHash,
            name: dto.name,
            phone: dto.phone,
            isGuest: true,
          },
        });

        await tx.clubeMembership.create({
          data: {
            clubeId,
            userId: guest.id,
            role: 'PLAYER',
            status: 'ACTIVE',
          },
        });

        const wallet = await tx.wallet.create({
          data: { userId: guest.id, clubeId },
        });

        // Entrada em espécie — crédito explícito, ver docblock do método.
        await this.walletService.applyLedgerEntry(tx, wallet.id, {
          type: 'ADJUSTMENT',
          amount: buyIn,
          idempotencyKey: `guest-cash-in:${idempotencyKey}`,
          description: 'Entrada em dinheiro — jogador sem cadastro',
          createdById: adminId,
        });

        const created = await tx.tableSession.create({
          data: {
            clubeId,
            tableId,
            userId: guest.id,
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
            createdById: adminId,
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
      // P2002 de `users.email` (colisão do e-mail sintético — praticamente
      // impossível, 24 chars hex aleatórios) tem mensagem específica;
      // qualquer outro P2002 aqui só pode ser o índice único parcial de
      // assento/usuário ativo (mesma checagem de `sitAtTable`).
      const mapped = mapUniqueConstraintError(error);
      if (mapped !== error) {
        throw mapped;
      }
      if (isUniqueConstraintError(error)) {
        throw new ConflictException(
          'Assento já ocupado ou você já está sentado nesta mesa.',
        );
      }
      throw error;
    }
  }

  /**
   * Confere que `userId` tem vínculo `ACTIVE` neste clube — ver docblock de
   * `sitAtTableForUser`.
   */
  private async assertActiveMember(
    clubeId: string,
    userId: string,
  ): Promise<void> {
    const membership = await this.prisma.clubeMembership.findUnique({
      where: { clubeId_userId: { clubeId, userId } },
      select: { status: true },
    });
    if (!membership || membership.status !== 'ACTIVE') {
      throw new NotFoundException('Membro não encontrado neste clube.');
    }
  }

  /**
   * Cash-out do stack inteiro. Lock otimista via `version` (re-lê a sessão
   * DENTRO da transação — o valor lido antes de abrir a transação poderia
   * estar desatualizado se um `recordMovement` concorrente mudou o stack).
   */
  async cashOut(
    userId: string,
    clubeId: string,
    tableId: string,
    sessionId: string,
    idempotencyKey: string,
  ): Promise<TableSeatDto> {
    const session = await this.mustGetSession(clubeId, tableId, sessionId);
    if (session.userId !== userId) {
      throw new ForbiddenException(
        'Você só pode fazer cash-out da sua própria sessão.',
      );
    }
    return this.doCashOut(
      clubeId,
      tableId,
      sessionId,
      `cashout:${idempotencyKey}`,
    );
  }

  /**
   * ADMIN fazendo cash-out da sessão de OUTRO jogador — necessário porque um
   * convidado (`sitGuestAtTable`) nunca loga e nunca poderia chamar o
   * `cashOut` self-only; sem isso, ficaria travado no assento até a mesa
   * fechar inteira. Também útil pra qualquer jogador que peça ao staff pra
   * encerrar por ele. `createdById` fica registrado no `StackMovement` —
   * mesmo padrão de `recordMovement` (actor ≠ subject).
   */
  async cashOutAsAdmin(
    adminId: string,
    clubeId: string,
    tableId: string,
    sessionId: string,
    idempotencyKey: string,
  ): Promise<TableSeatDto> {
    return this.doCashOut(
      clubeId,
      tableId,
      sessionId,
      `admin-cashout:${idempotencyKey}`,
      adminId,
    );
  }

  /**
   * ADMIN registrando um NOVO buy-in numa sessão JÁ SENTADA (ex.: jogador
   * perdeu todas as fichas mas continua na mesa) — mesmo lançamento de
   * `sitAtTable` (debita a wallet, `StackMovement` BUY_IN, mesma faixa
   * `minBuyIn`/`maxBuyIn` da mesa), só que soma ao stack/totalBuyIn da
   * sessão existente em vez de criar uma sessão nova. Mesmo padrão de retry
   * + optimistic lock de `doCashOut`, porque também cruza a wallet dentro
   * de uma corrida possível com cash-out/ajuste concorrentes na mesma
   * sessão.
   */
  async rebuy(
    adminId: string,
    clubeId: string,
    tableId: string,
    sessionId: string,
    dto: RebuyDto,
    idempotencyKey: string,
  ): Promise<TableSeatDto> {
    const table = await this.prisma.table.findUnique({
      where: { id: tableId },
    });
    if (!table || table.clubeId !== clubeId) {
      throw new NotFoundException('Mesa não encontrada.');
    }

    const buyIn = new Prisma.Decimal(dto.buyInAmount);
    if (buyIn.lessThan(table.minBuyIn) || buyIn.greaterThan(table.maxBuyIn)) {
      throw new BadRequestException(
        `Buy-in deve estar entre ${table.minBuyIn.toFixed(2)} e ${table.maxBuyIn.toFixed(2)}.`,
      );
    }

    const ledgerKey = `rebuy:${idempotencyKey}`;
    const existingTxn = await this.prisma.walletTransaction.findUnique({
      where: { idempotencyKey: ledgerKey },
    });
    if (existingTxn) {
      return toSeatDto(await this.mustGetSession(clubeId, tableId, sessionId));
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const fresh = await this.mustGetSession(clubeId, tableId, sessionId);
      if (fresh.status !== 'ACTIVE') {
        throw new BadRequestException('Sessão já encerrada.');
      }

      const wallet = await this.prisma.wallet.findUniqueOrThrow({
        where: { userId_clubeId: { userId: fresh.userId, clubeId } },
      });
      const newStack = fresh.currentStack.add(buyIn);

      try {
        const result = await this.prisma.withClube(clubeId, async (tx) => {
          const walletTxn = await this.walletService.applyLedgerEntry(
            tx,
            wallet.id,
            {
              type: 'TABLE_BUY_IN',
              amount: buyIn.negated(),
              idempotencyKey: ledgerKey,
              description: 'Buy-in adicional em mesa',
              tableSessionId: sessionId,
            },
          );

          const updateResult = await tx.tableSession.updateMany({
            where: { id: sessionId, version: fresh.version },
            data: {
              currentStack: newStack,
              totalBuyIn: { increment: buyIn },
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
              amount: buyIn,
              reason: 'BUY_IN',
              stackAfter: newStack,
              walletTransactionId: walletTxn.id,
              createdById: adminId,
            },
          });

          return toSeatDto({
            id: sessionId,
            seatNumber: fresh.seatNumber,
            currentStack: newStack,
            user: { id: fresh.userId, name: fresh.userName },
          });
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

  /** Núcleo do cash-out, sem checagem de dono — reaproveitado pelo fechamento de mesa pelo admin. */
  private async doCashOut(
    clubeId: string,
    tableId: string,
    sessionId: string,
    ledgerKey: string,
    createdById?: string,
  ): Promise<TableSeatDto> {
    const existingTxn = await this.prisma.walletTransaction.findUnique({
      where: { idempotencyKey: ledgerKey },
    });
    if (existingTxn) {
      return EMPTY_SEAT(
        (await this.mustGetSession(clubeId, tableId, sessionId)).seatNumber,
      );
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const fresh = await this.mustGetSession(clubeId, tableId, sessionId);
      if (fresh.status !== 'ACTIVE') {
        throw new BadRequestException('Sessão já encerrada.');
      }

      const wallet = await this.prisma.wallet.findUniqueOrThrow({
        where: { userId_clubeId: { userId: fresh.userId, clubeId } },
      });
      const amount = fresh.currentStack;

      try {
        const result = await this.prisma.withClube(clubeId, async (tx) => {
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
              createdById,
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

  /**
   * Fecha a mesa: faz cash-out de todas as sessões ativas (devolve o stack
   * para a wallet de cada jogador, mesmo lançamento usado no cash-out normal),
   * marca a mesa como CLOSED e devolve o relatório de buy-ins por jogador
   * (agregado de TODAS as sessões da mesa, não só as fechadas agora — ver
   * `toTableCloseReport`). Idempotente — mesa já fechada só refaz o relatório.
   *
   * Corrida pré-existente, não corrigida aqui: `sitAtTable` só checa
   * `status === 'OPEN'` uma vez no início da request, sem lock cobrindo este
   * método inteiro — uma sessão criada bem no meio do fechamento pode
   * escapar do loop de cash-out abaixo. Por isso a fórmula do relatório
   * inclui `currentStack` em vez de assumir que é sempre 0 pós-fechamento.
   */
  async closeTable(
    clubeId: string,
    tableId: string,
  ): Promise<TableCloseResultDto> {
    const table = await this.prisma.table.findUnique({
      where: { id: tableId },
    });
    if (!table || table.clubeId !== clubeId) {
      throw new NotFoundException('Mesa não encontrada.');
    }

    if (table.status !== 'CLOSED') {
      const activeSessions = await this.prisma.tableSession.findMany({
        where: { tableId, status: 'ACTIVE' },
        select: { id: true },
      });
      for (const { id: sessionId } of activeSessions) {
        await this.doCashOut(
          clubeId,
          tableId,
          sessionId,
          `close-table:${sessionId}`,
        );
      }
      await this.prisma.table.update({
        where: { id: tableId },
        data: { status: 'CLOSED' },
      });
    }

    const sessions = await this.prisma.tableSession.findMany({
      where: { tableId },
      include: { user: { select: { id: true, name: true } } },
    });

    return {
      table: toTableSummaryDto({
        ...table,
        status: 'CLOSED',
        _count: { sessions: 0 },
      }),
      players: toTableCloseReport(sessions),
    };
  }

  /**
   * Reabre uma mesa fechada: volta o status para OPEN, permitindo novos
   * sits. Não há sessões pra restaurar — `closeTable` já fez cash-out de
   * todo mundo antes de fechar, então a mesa reabre vazia. Idempotente
   * (mesa já OPEN só retorna o estado atual), mesmo padrão de `closeTable`.
   */
  async reopenTable(
    clubeId: string,
    tableId: string,
  ): Promise<TableSummaryDto> {
    const table = await this.prisma.table.findUnique({
      where: { id: tableId },
      include: {
        _count: { select: { sessions: { where: { status: 'ACTIVE' } } } },
      },
    });
    if (!table || table.clubeId !== clubeId) {
      throw new NotFoundException('Mesa não encontrada.');
    }

    if (table.status !== 'CLOSED') {
      return toTableSummaryDto(table);
    }

    const reopened = await this.prisma.table.update({
      where: { id: tableId },
      data: { status: 'OPEN' },
      include: {
        _count: { select: { sessions: { where: { status: 'ACTIVE' } } } },
      },
    });

    return toTableSummaryDto(reopened);
  }

  /** Registra HAND_RESULT/ADJUSTMENT — NUNCA cruza a wallet (ver StackMovementReason em table.prisma). */
  async recordMovement(
    adminId: string,
    clubeId: string,
    tableId: string,
    sessionId: string,
    dto: RecordMovementDto,
  ): Promise<TableSeatDto> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const fresh = await this.mustGetSession(clubeId, tableId, sessionId);
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

  /**
   * Busca a sessão por id e confirma que pertence à mesa E ao clube da
   * requisição — mesma checagem de posse que já existia para `tableId`,
   * estendida a `clubeId` (CL-BE-05). `TableSession` é model escopado
   * (`CLUBE_SCOPED_MODELS`), mas esta leitura roda fora de `withClube`, então
   * o filtro é manual aqui.
   */
  private async mustGetSession(
    clubeId: string,
    tableId: string,
    sessionId: string,
  ) {
    const session = await this.prisma.tableSession.findUnique({
      where: { id: sessionId },
      include: { user: { select: { id: true, name: true } } },
    });
    if (
      !session ||
      session.tableId !== tableId ||
      session.clubeId !== clubeId
    ) {
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
