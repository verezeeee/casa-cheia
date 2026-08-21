import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  PaginatedResponse,
  TournamentDetailResponse,
  TournamentEntryDto,
  TournamentSummaryDto,
} from '@poker-system/shared';
import { Prisma } from '@prisma/client';
import { decodeCursor, encodeCursor } from '../common/pagination/cursor';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import type { CreateTournamentDto } from './dto/create-tournament.dto';
import type { EliminateEntryDto } from './dto/eliminate-entry.dto';
import {
  toTournamentDetailResponse,
  toTournamentEntryDto,
  toTournamentSummaryDto,
} from './tournament.mappers';

const DEFAULT_PAGE_SIZE = 20;
const PERCENTAGE_TOLERANCE = new Prisma.Decimal('0.01'); // folga de arredondamento (centésimos)
const ONE_HUNDRED = new Prisma.Decimal('100');

@Injectable()
export class TournamentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
  ) {}

  /**
   * Cria o torneio já com a grade de premiação completa e em REGISTERING —
   * este MVP não modela o estágio DRAFT como um passo à parte (o admin
   * fornece tudo de uma vez); ver `base.prisma`/`tournament.prisma` para a
   * máquina de estados completa que o schema já suporta.
   */
  async createTournament(
    adminId: string,
    dto: CreateTournamentDto,
  ): Promise<TournamentSummaryDto> {
    const sum = dto.prizes.reduce(
      (total, prize) => total.add(new Prisma.Decimal(prize.percentage)),
      new Prisma.Decimal(0),
    );
    if (sum.minus(ONE_HUNDRED).abs().greaterThan(PERCENTAGE_TOLERANCE)) {
      throw new BadRequestException(
        `A soma dos percentuais da grade de premiação deve ser 100.00 (atual: ${sum.toFixed(2)}).`,
      );
    }
    const positions = dto.prizes.map((p) => p.position);
    if (new Set(positions).size !== positions.length) {
      throw new BadRequestException(
        'Colocações da grade de premiação não podem se repetir.',
      );
    }

    const tournament = await this.prisma.tournament.create({
      data: {
        name: dto.name,
        buyIn: dto.buyIn,
        fee: dto.fee,
        startingStack: dto.startingStack,
        maxPlayers: dto.maxPlayers,
        status: 'REGISTERING',
        startsAt: new Date(dto.startsAt),
        lateRegUntil: dto.lateRegUntil ? new Date(dto.lateRegUntil) : null,
        guaranteedPrize: dto.guaranteedPrize,
        createdById: adminId,
        prizes: {
          create: dto.prizes.map((p) => ({
            position: p.position,
            percentage: p.percentage,
          })),
        },
      },
    });

    return toTournamentSummaryDto({ ...tournament, _count: { entries: 0 } });
  }

  async listTournaments(
    cursor: string | undefined,
    limit: number | undefined,
  ): Promise<PaginatedResponse<TournamentSummaryDto>> {
    const pageSize = limit ?? DEFAULT_PAGE_SIZE;
    const after = cursor ? decodeCursor(cursor) : null;

    const rows = await this.prisma.tournament.findMany({
      where: after
        ? {
            OR: [
              { createdAt: { lt: after.createdAt } },
              { createdAt: after.createdAt, id: { lt: after.id } },
            ],
          }
        : {},
      include: { _count: { select: { entries: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: pageSize + 1,
    });

    const hasMore = rows.length > pageSize;
    const page = hasMore ? rows.slice(0, pageSize) : rows;
    const last = page[page.length - 1];

    return {
      items: page.map(toTournamentSummaryDto),
      nextCursor: hasMore && last ? encodeCursor(last) : null,
    };
  }

  async getTournament(id: string): Promise<TournamentDetailResponse> {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id },
      include: { _count: { select: { entries: true } } },
    });
    if (!tournament) throw new NotFoundException('Torneio não encontrado.');

    const [prizes, entries] = await Promise.all([
      this.prisma.tournamentPrize.findMany({
        where: { tournamentId: id },
        orderBy: { position: 'asc' },
      }),
      this.prisma.tournamentEntry.findMany({
        where: { tournamentId: id },
        include: { user: { select: { name: true } } },
        orderBy: { registeredAt: 'asc' },
      }),
    ]);

    return toTournamentDetailResponse(tournament, prizes, entries);
  }

  /**
   * Inscrição: debita `buyIn + fee` da wallet e cria a `TournamentEntry` na
   * MESMA transação, com o `Tournament.prizePool`/`version` atualizados sob
   * lock otimista — mesmo padrão de `TableService.sitAtTable` (criar a
   * dependência local primeiro, só então mover dinheiro).
   */
  async registerEntry(
    userId: string,
    tournamentId: string,
    idempotencyKey: string,
  ): Promise<TournamentEntryDto> {
    const ledgerKey = `tournament-buyin:${idempotencyKey}`;

    const existingTxn = await this.prisma.walletTransaction.findUnique({
      where: { idempotencyKey: ledgerKey },
    });
    if (existingTxn?.tournamentEntryId) {
      const existingEntry = await this.prisma.tournamentEntry.findUnique({
        where: { id: existingTxn.tournamentEntryId },
        include: { user: { select: { name: true } } },
      });
      if (existingEntry) return toTournamentEntryDto(existingEntry);
    }

    const wallet = await this.prisma.wallet.findUniqueOrThrow({
      where: { userId },
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const tournament = await this.prisma.tournament.findUnique({
        where: { id: tournamentId },
      });
      if (!tournament) throw new NotFoundException('Torneio não encontrado.');
      if (tournament.status !== 'REGISTERING') {
        throw new BadRequestException(
          'Inscrições não estão abertas para este torneio.',
        );
      }

      // ponytail: contagem lida fora da transação — duas inscrições
      // simultâneas podem passar aqui juntas e a mesa ultrapassar
      // maxPlayers em 1-2 vagas na última rodada. Sem impacto financeiro
      // (cada inscrição debita e credita corretamente); se a casa exigir
      // capacidade rígida, trocar por SELECT ... FOR UPDATE na linha do
      // Tournament antes desta contagem.
      const registeredCount = await this.prisma.tournamentEntry.count({
        where: { tournamentId, status: { not: 'REFUNDED' } },
      });
      if (registeredCount >= tournament.maxPlayers) {
        throw new BadRequestException('Torneio lotado.');
      }

      const total = new Prisma.Decimal(tournament.buyIn).add(tournament.fee);

      try {
        const entry = await this.prisma.$transaction(async (tx) => {
          const created = await tx.tournamentEntry.create({
            data: {
              tournamentId,
              userId,
              status: 'REGISTERED',
              chipStack: tournament.startingStack,
            },
          });

          const walletTxn = await this.walletService.applyLedgerEntry(
            tx,
            wallet.id,
            {
              type: 'TOURNAMENT_BUY_IN',
              amount: total.negated(),
              idempotencyKey: ledgerKey,
              description: 'Inscrição em torneio',
              tournamentEntryId: created.id,
            },
          );

          const updateResult = await tx.tournament.updateMany({
            where: { id: tournamentId, version: tournament.version },
            data: {
              prizePool: { increment: tournament.buyIn },
              version: { increment: 1 },
            },
          });
          if (updateResult.count === 0) {
            throw new OptimisticLockError();
          }

          return tx.tournamentEntry.update({
            where: { id: created.id },
            data: { buyInTransactionId: walletTxn.id },
            include: { user: { select: { name: true } } },
          });
        });

        return toTournamentEntryDto(entry);
      } catch (error) {
        if (error instanceof OptimisticLockError) continue;
        if (isUniqueConstraintError(error)) {
          throw new ConflictException('Você já está inscrito neste torneio.');
        }
        throw error;
      }
    }

    throw new ConflictException(
      'Muita concorrência nas inscrições — tente novamente.',
    );
  }

  /** ADMIN: marca a eliminação e, opcionalmente, a colocação final. */
  async eliminateEntry(
    tournamentId: string,
    entryId: string,
    dto: EliminateEntryDto,
  ): Promise<TournamentEntryDto> {
    const entry = await this.prisma.tournamentEntry.findUnique({
      where: { id: entryId },
    });
    if (!entry || entry.tournamentId !== tournamentId) {
      throw new NotFoundException('Inscrição não encontrada.');
    }
    if (entry.status === 'ELIMINATED' || entry.status === 'PAID') {
      throw new BadRequestException('Inscrição já foi eliminada.');
    }

    // Primeira eliminação: REGISTERING -> RUNNING (o torneio "começou a jogar").
    await this.prisma.tournament.updateMany({
      where: { id: tournamentId, status: 'REGISTERING' },
      data: { status: 'RUNNING' },
    });

    const updated = await this.prisma.tournamentEntry.update({
      where: { id: entryId },
      data: {
        status: 'ELIMINATED',
        eliminatedAt: new Date(),
        finalPosition: dto.finalPosition,
        chipStack: 0,
      },
      include: { user: { select: { name: true } } },
    });

    return toTournamentEntryDto(updated);
  }

  /**
   * Encerra o torneio e paga a grade. A colocação de 1º lugar é inferida
   * automaticamente quando não foi marcada manualmente: se sobrar
   * EXATAMENTE uma inscrição ainda não eliminada, ela é o campeão. Qualquer
   * outra posição premiada exige `finalPosition` já registrado via
   * `eliminateEntry` — este MVP não infere colocações intermediárias sozinho.
   */
  async finishTournament(
    tournamentId: string,
  ): Promise<TournamentDetailResponse> {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
    });
    if (!tournament) throw new NotFoundException('Torneio não encontrado.');
    if (
      tournament.status !== 'REGISTERING' &&
      tournament.status !== 'RUNNING'
    ) {
      throw new BadRequestException('Torneio já foi encerrado ou cancelado.');
    }

    const prizes = await this.prisma.tournamentPrize.findMany({
      where: { tournamentId },
      orderBy: { position: 'asc' },
    });
    const entries = await this.prisma.tournamentEntry.findMany({
      where: { tournamentId },
    });

    const remaining = entries.filter(
      (e) => e.status !== 'ELIMINATED' && e.status !== 'PAID',
    );
    let winnerId: string | null = null;
    if (remaining.length === 1) {
      winnerId = remaining[0].id;
    } else if (remaining.length > 1 && prizes.some((p) => p.position === 1)) {
      throw new BadRequestException(
        `${remaining.length} inscrições ainda ativas — elimine até restar 1 (o campeão) antes de encerrar.`,
      );
    }

    const byPosition = new Map(entries.map((e) => [e.finalPosition, e]));
    if (winnerId) {
      const winner = entries.find((e) => e.id === winnerId)!;
      byPosition.set(1, winner);
    }

    const payouts: Array<{
      entryId: string;
      amount: Prisma.Decimal;
      position: number;
    }> = [];
    for (const prize of prizes) {
      const entry = byPosition.get(prize.position);
      if (!entry) {
        throw new BadRequestException(
          `Nenhuma inscrição com finalPosition=${prize.position} (colocação premiada) — registre a eliminação com essa colocação antes de encerrar.`,
        );
      }
      if (entry.payoutTransactionId) continue; // já pago (reexecução idempotente do finish)

      const amount = tournament.prizePool
        .times(new Prisma.Decimal(prize.percentage))
        .dividedBy(ONE_HUNDRED)
        .toDecimalPlaces(2);
      payouts.push({ entryId: entry.id, amount, position: prize.position });
    }

    // Campeão sem prêmio cadastrado na posição 1 (grade sem 1º lugar, caso
    // raro): ainda assim marca a colocação, sem tocar status/wallet.
    const winnerNeedsPositionOnly =
      winnerId !== null && !payouts.some((p) => p.entryId === winnerId);

    await this.prisma.$transaction(async (tx) => {
      for (const payout of payouts) {
        const entry = byPosition.get(payout.position)!;
        const wallet = await tx.wallet.findUniqueOrThrow({
          where: { userId: entry.userId },
        });

        const walletTxn = await this.walletService.applyLedgerEntry(
          tx,
          wallet.id,
          {
            type: 'TOURNAMENT_PAYOUT',
            amount: payout.amount,
            // Idempotência natural: uma entry só é paga uma vez (payoutTransactionId é @unique).
            idempotencyKey: `tournament-payout:${payout.entryId}`,
            description: `Premiação de torneio — ${payout.position}º lugar`,
            tournamentEntryId: payout.entryId,
          },
        );

        await tx.tournamentEntry.update({
          where: { id: payout.entryId },
          data: {
            status: 'PAID',
            prizeAmount: payout.amount,
            payoutTransactionId: walletTxn.id,
            finalPosition: payout.position,
          },
        });
      }

      if (winnerNeedsPositionOnly) {
        await tx.tournamentEntry.update({
          where: { id: winnerId! },
          data: { finalPosition: 1 },
        });
      }

      await tx.tournament.update({
        where: { id: tournamentId },
        data: { status: 'FINISHED', finishedAt: new Date() },
      });
    });

    return this.getTournament(tournamentId);
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
