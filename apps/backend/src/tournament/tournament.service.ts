import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  PaginatedResponse,
  PublicTournamentTableMapDto,
  TournamentDetailResponse,
  TournamentEntryDto,
  TournamentSummaryDto,
  TournamentTableMapDto,
} from '@poker-system/shared';
import { Prisma } from '../generated/prisma';
import { decodeCursor, encodeCursor } from '../common/pagination/cursor';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import type { CreateTournamentDto } from './dto/create-tournament.dto';
import type { EliminateEntryDto } from './dto/eliminate-entry.dto';
import type { UpdateTournamentDto } from './dto/update-tournament.dto';
import type { Move, TableSnapshot } from './seating';
import { planInitialSeat, planRebalance, planRedraw } from './seating';
import type { TournamentTableRow } from './tournament.mappers';
import {
  advanceClockToNow,
  toPublicTournamentTableMapDto,
  toTournamentDetailResponse,
  toTournamentEntryDto,
  toTournamentSummaryDto,
  toTournamentTableMapDto,
} from './tournament.mappers';

const DEFAULT_PAGE_SIZE = 20;
const PERCENTAGE_TOLERANCE = new Prisma.Decimal('0.01'); // folga de arredondamento (centésimos)
const ONE_HUNDRED = new Prisma.Decimal('100');
/** Casa com o CHECK `tournaments_table_capacity_valid` (full ring). */
const DEFAULT_TABLE_CAPACITY = 9;
/** Inscrições que ocupam vaga e assento — as demais já saíram do torneio. */
const ALIVE_STATUSES = ['REGISTERED', 'PLAYING'] as const;

/**
 * Inscrição + assento ATIVO, o "ticket" do PRD §5.1. O `where: { active: true }`
 * é obrigatório: sem ele o histórico append-only de `TournamentSeat` traria
 * assentos antigos e o DTO mostraria uma mesa onde o jogador não está mais.
 */
const ENTRY_INCLUDE = {
  user: { select: { name: true } },
  seats: {
    where: { active: true },
    select: {
      seatNumber: true,
      tournamentTable: { select: { tableNumber: true } },
    },
  },
} satisfies Prisma.TournamentEntryInclude;

/**
 * Mesas do torneio com a ocupação corrente. Um único shape para os três usos
 * (planejar assento, fechar mesa vazia e montar o `TournamentTableMapDto`) —
 * são no máximo algumas dezenas de linhas por torneio, e uma segunda query
 * "mais enxuta" pagaria em complexidade o que economizaria em join.
 */
const TABLE_SELECT = {
  id: true,
  tableNumber: true,
  capacity: true,
  status: true,
  seats: {
    where: { active: true },
    select: {
      seatNumber: true,
      tournamentEntry: {
        select: {
          id: true,
          userId: true,
          chipStack: true,
          user: { select: { name: true } },
        },
      },
    },
  },
} satisfies Prisma.TournamentTableSelect;

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
   *
   * MT-BE-03: quando vem `blindStructureId`, os níveis do preset são COPIADOS
   * para `TournamentBlindLevel` no MESMO `create` (nested write ⇒ mesma
   * transação implícita do Prisma). A partir daí o torneio é dono da sua
   * grade: editar o preset depois não o afeta. Sem `blindStructureId` o
   * torneio nasce sem relógio, exatamente como antes deste MVP.
   */
  async createTournament(
    adminId: string,
    clubeId: string,
    dto: CreateTournamentDto,
  ): Promise<TournamentSummaryDto> {
    assertValidPrizeGrade(dto.prizes);

    const levels = await this.copyBlindLevels(dto.blindStructureId);
    assertCoherentReentryConfig(dto, levels.length);
    assertCoherentStaffBonusConfig(dto);

    const tournament = await this.prisma.tournament.create({
      data: {
        clubeId,
        name: dto.name,
        buyIn: dto.buyIn,
        fee: dto.fee,
        staffBonusCost: dto.staffBonusCost,
        staffBonusChips: dto.staffBonusChips,
        startingStack: dto.startingStack,
        maxPlayers: dto.maxPlayers,
        tableCapacity: dto.tableCapacity ?? DEFAULT_TABLE_CAPACITY,
        status: 'REGISTERING',
        startsAt: new Date(dto.startsAt),
        lateRegUntil: dto.lateRegUntil ? new Date(dto.lateRegUntil) : null,
        guaranteedPrize: dto.guaranteedPrize,
        createdById: adminId,
        blindStructureId: dto.blindStructureId,
        allowReentry: dto.allowReentry ?? false,
        maxReentries: dto.maxReentries,
        reentryUntilLevel: dto.reentryUntilLevel,
        prizes: {
          create: dto.prizes.map((p) => ({
            position: p.position,
            percentage: p.percentage,
          })),
        },
        blindLevels: { create: levels },
      },
    });

    return toTournamentSummaryDto({ ...tournament, _count: { entries: 0 } });
  }

  /**
   * Edita a configuração do torneio (nome, buy-in, fee, bônus de staff,
   * fichas, vagas, horário, grade de premiação, reentry, estrutura de
   * blinds) — SÓ enquanto `status === 'REGISTERING'` e NINGUÉM se inscreveu
   * ainda. Depois da 1ª inscrição a configuração trava: mudar buyIn/fee/
   * staffBonus/prizes com gente já inscrita faria jogadores pagando ou
   * disputando coisas diferentes dentro do MESMO torneio. `status` nasce
   * direto em REGISTERING (DRAFT não é usado de verdade, ver docblock de
   * `createTournament`) — "antes da 1ª inscrição" É o estágio de rascunho.
   *
   * ATOMICIDADE SEM LOCK PESSIMISTA: o filtro `entries: { none: { status: {
   * not: 'REFUNDED' } } }` no WHERE do `updateMany` é o que protege contra
   * uma inscrição concorrente entre a leitura abaixo e esta escrita — se
   * alguém se inscrever nesse meio-tempo, a condição deixa de bater, `count`
   * vem 0 e devolvemos 409. Mais barato que `lockTournament`: não há recurso
   * em disputa a serializar, só uma corrida rara a detectar. Exclui REFUNDED
   * de propósito: cancelamento não deve travar a edição (mesmo critério do
   * `_count.entries` abaixo).
   */
  async updateTournament(
    clubeId: string,
    tournamentId: string,
    dto: UpdateTournamentDto,
  ): Promise<TournamentSummaryDto> {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId, clubeId },
      include: {
        blindLevels: { orderBy: { levelNumber: 'asc' } },
        _count: {
          select: { entries: { where: { status: { not: 'REFUNDED' } } } },
        },
      },
    });
    if (!tournament) throw new NotFoundException('Torneio não encontrado.');
    if (tournament.status !== 'REGISTERING' || tournament._count.entries > 0) {
      throw new BadRequestException(
        'Só é possível editar o torneio antes da primeira inscrição.',
      );
    }

    if (dto.prizes) assertValidPrizeGrade(dto.prizes);

    // Trocando a estrutura: copia os níveis novos JÁ (404 cedo se o preset
    // não existe, mesmo comportamento de `createTournament`) e exige o
    // relógio intocado — não faz sentido substituir a grade com ele rodando.
    let newLevels: Prisma.TournamentBlindLevelCreateManyInput[] | null = null;
    if (dto.blindStructureId !== undefined) {
      if (tournament.clockStatus !== 'NOT_STARTED') {
        throw new BadRequestException(
          'Não é possível trocar a estrutura de blinds com o relógio já iniciado.',
        );
      }
      const copied = await this.copyBlindLevels(dto.blindStructureId);
      newLevels = copied.map((level) => ({ ...level, tournamentId }));
    }
    const effectiveLevelCount =
      newLevels?.length ?? tournament.blindLevels.length;

    // ESTADO EFETIVO (patch mesclado sobre o que já está gravado) — não o
    // patch isolado. Ver docblock de `assertCoherentReentryConfig`.
    assertCoherentReentryConfig(
      {
        allowReentry: dto.allowReentry ?? tournament.allowReentry,
        maxReentries:
          dto.maxReentries !== undefined
            ? dto.maxReentries
            : (tournament.maxReentries ?? undefined),
        reentryUntilLevel:
          dto.reentryUntilLevel !== undefined
            ? dto.reentryUntilLevel
            : (tournament.reentryUntilLevel ?? undefined),
      },
      effectiveLevelCount,
    );
    assertCoherentStaffBonusConfig({
      staffBonusCost:
        dto.staffBonusCost !== undefined
          ? dto.staffBonusCost
          : (tournament.staffBonusCost?.toString() ?? undefined),
      staffBonusChips:
        dto.staffBonusChips !== undefined
          ? dto.staffBonusChips
          : (tournament.staffBonusChips ?? undefined),
    });

    const updated = await this.prisma.withClube(clubeId, async (tx) => {
      const result = await tx.tournament.updateMany({
        where: {
          id: tournamentId,
          clubeId,
          status: 'REGISTERING',
          // `none` sobre não-REFUNDED: uma inscrição CANCELADA não deixa o
          // torneio travado pra edição (mesmo critério do `_count.entries`
          // logo acima e de `ALIVE_STATUSES`/`previousEntries` no resto do
          // service) — sem isto, alguém que se inscreveu e cancelou impedia
          // o admin de editar um torneio que, na prática, ninguém disputa.
          entries: { none: { status: { not: 'REFUNDED' } } },
        },
        data: {
          name: dto.name,
          buyIn: dto.buyIn,
          fee: dto.fee,
          staffBonusCost: dto.staffBonusCost,
          staffBonusChips: dto.staffBonusChips,
          startingStack: dto.startingStack,
          maxPlayers: dto.maxPlayers,
          tableCapacity: dto.tableCapacity,
          startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
          lateRegUntil: dto.lateRegUntil
            ? new Date(dto.lateRegUntil)
            : undefined,
          guaranteedPrize: dto.guaranteedPrize,
          blindStructureId: dto.blindStructureId,
          allowReentry: dto.allowReentry,
          maxReentries: dto.maxReentries,
          reentryUntilLevel: dto.reentryUntilLevel,
          version: { increment: 1 },
        },
      });
      if (result.count === 0) {
        throw new ConflictException(
          'O torneio mudou (alguém se inscreveu) durante a edição — recarregue e tente de novo.',
        );
      }

      if (dto.prizes) {
        await tx.tournamentPrize.deleteMany({ where: { tournamentId } });
        await tx.tournamentPrize.createMany({
          data: dto.prizes.map((p) => ({
            tournamentId,
            position: p.position,
            percentage: p.percentage,
          })),
        });
      }

      if (newLevels) {
        await tx.tournamentBlindLevel.deleteMany({ where: { tournamentId } });
        await tx.tournamentBlindLevel.createMany({ data: newLevels });
      }

      return tx.tournament.findUniqueOrThrow({
        where: { id: tournamentId },
        include: {
          _count: {
            select: { entries: { where: { status: { not: 'REFUNDED' } } } },
          },
        },
      });
    });

    return toTournamentSummaryDto(updated);
  }

  async listTournaments(
    clubeId: string,
    cursor: string | undefined,
    limit: number | undefined,
  ): Promise<PaginatedResponse<TournamentSummaryDto>> {
    const pageSize = limit ?? DEFAULT_PAGE_SIZE;
    const after = cursor ? decodeCursor(cursor) : null;

    const rows = await this.prisma.tournament.findMany({
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
        _count: {
          select: { entries: { where: { status: { not: 'REFUNDED' } } } },
        },
      },
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

  async getTournament(
    clubeId: string,
    id: string,
  ): Promise<TournamentDetailResponse> {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id, clubeId },
      include: {
        _count: {
          select: { entries: { where: { status: { not: 'REFUNDED' } } } },
        },
      },
    });
    if (!tournament) throw new NotFoundException('Torneio não encontrado.');

    const [prizes, entries] = await Promise.all([
      this.prisma.tournamentPrize.findMany({
        where: { tournamentId: id },
        orderBy: { position: 'asc' },
      }),
      this.prisma.tournamentEntry.findMany({
        where: { tournamentId: id },
        include: ENTRY_INCLUDE,
        orderBy: { registeredAt: 'asc' },
      }),
    ]);

    return toTournamentDetailResponse(tournament, prizes, entries);
  }

  /**
   * Inscrição (MT-BE-04) e REENTRADA (MT-BE-09): debita `buyIn + fee` da
   * wallet, cria a `TournamentEntry` e SENTA o jogador — tudo na MESMA
   * transação, serializada por torneio pelo mesmo lock pessimista da
   * eliminação.
   *
   * POR QUE LOCK PESSIMISTA AQUI TAMBÉM (MT-QA-01)
   * A versão anterior protegia o `prizePool` com lock OTIMISTA de `version` e
   * 3 tentativas. Sob concorrência real isso é um thundering herd: cada rodada
   * de retry admite exatamente UM vencedor, então 20 inscrições simultâneas
   * viravam 4 inscrições e 16 respostas `409 Muita concorrência` — inscrições
   * legítimas perdidas, com o jogador já na fila do caixa. Inscrição PLANEJA
   * ASSENTO sobre o mapa de mesas, exatamente como a eliminação; é a mesma
   * seção crítica e agora usa a mesma serialização (`lockTournament`). Todo
   * escritor de `TournamentSeat` (inscrição, eliminação, redraw) segura o lock
   * do torneio — por isso não existe mais colisão de assento a retentar.
   *
   * TUDO QUE DECIDE É LIDO DENTRO DA TRANSAÇÃO, depois do lock: torneio,
   * inscrições anteriores e contagem de vivos. Ler `maxPlayers` fora do lock
   * deixava duas inscrições simultâneas estourarem a lotação.
   *
   * ORDEM DAS ESCRITAS DENTRO DA TRANSAÇÃO (fluxo MT-003)
   * A entry é inserida antes do lançamento de wallet porque
   * `WalletTransaction.tournamentEntryId` aponta PARA ela (a FK obriga a
   * ordem), e não porque a ficha nasce antes do dinheiro: as duas escritas
   * commitam juntas ou não commitam. Saldo insuficiente ⇒
   * `applyLedgerEntry` lança ⇒ a transação inteira reverte e não sobra entry,
   * ficha nem assento. É o padrão já validado do módulo, reafirmado por
   * MT-003.
   *
   * ORDEM DOS LOCKS: torneio ANTES de wallet, aqui e em `finishTournament` —
   * as duas únicas operações que seguram os dois. Inverter em uma delas
   * fecharia um ciclo de deadlock.
   *
   * COMPOSIÇÃO `planInitialSeat` + `planRebalance` (lacuna deixada em
   * `seating.ts`): quando a inscrição ABRE uma mesa nova e já havia mesa
   * aberta, o rebalanceamento roda na mesma transação sobre o estado
   * pós-abertura. Sem isso a mesa nasceria 9/1 e a invariante `max-min <= 1`
   * só valeria "no fim das contas"; com isso ela vale a cada commit, que é o
   * que a tela de staff e o e2e observam. O custo é concentrado: 4-5 moves na
   * inscrição que abre a mesa, zero nas demais.
   */
  async registerEntry(
    userId: string,
    clubeId: string,
    tournamentId: string,
    idempotencyKey: string,
    staffBonus = false,
  ): Promise<TournamentEntryDto> {
    const ledgerKey = `tournament-buyin:${idempotencyKey}`;

    const replay = await findReplay(this.prisma, clubeId, ledgerKey);
    if (replay) return toTournamentEntryDto(replay);

    const wallet = await this.prisma.wallet.findUniqueOrThrow({
      where: { userId_clubeId: { userId, clubeId } },
    });

    try {
      const entry = await this.prisma.withClube(clubeId, async (tx) => {
        await lockTournament(tx, clubeId, tournamentId);

        // Idempotência CONFERIDA DE NOVO, agora sob o lock. A checagem de fora
        // é só o caminho rápido: num duplo-clique as duas cópias passam por
        // ela antes de qualquer commit, e a perdedora chegaria aqui achando
        // que é uma inscrição nova — para virar 400 "não permite reentrada"
        // (ou 409 "já inscrito"), dizendo ao caixa que falhou uma inscrição
        // que existe e está paga. Sob o lock, ou a gêmea já commitou e é
        // encontrada aqui, ou ela ainda nem começou.
        const twin = await findReplay(tx, clubeId, ledgerKey);
        if (twin) return twin;

        const tournament = await tx.tournament.findUniqueOrThrow({
          where: { id: tournamentId },
          include: { blindLevels: { orderBy: { levelNumber: 'asc' } } },
        });

        // Inscrições ANTERIORES deste jogador neste torneio (as vivas o banco
        // já barra em `tournament_entries_active_user_unique`): > 0 significa
        // reentrada, e reentrada tem regras próprias.
        const previousEntries = await tx.tournamentEntry.count({
          where: { tournamentId, userId, status: { not: 'REFUNDED' } },
        });
        // Nível EFETIVO (não o gravado): o relógio anda sozinho por tempo de
        // parede (`advanceClockToNow`) e ninguém pode ter mexido nele
        // recentemente — sem isto, o corte por nível abaixo deixaria passar
        // uma inscrição tardia só porque a coluna no banco ainda não tinha
        // sido atualizada por um `next()` manual.
        const now = new Date();
        const currentLevelNumber = advanceClockToNow(
          tournament,
          tournament.blindLevels,
          now,
        ).currentLevelNumber;
        assertRegistrationAllowed(
          { ...tournament, currentLevelNumber },
          previousEntries,
          now,
        );

        // Conta só quem está VIVO: com reentry, o eliminado devolveu a vaga.
        const aliveCount = await tx.tournamentEntry.count({
          where: { tournamentId, status: { in: [...ALIVE_STATUSES] } },
        });
        if (aliveCount >= tournament.maxPlayers) {
          throw new BadRequestException('Torneio lotado.');
        }

        // Bônus de staff (staff add-on): OPCIONAL por jogador, bypassa o
        // prize pool como `fee` — ver docblock de `Tournament.staffBonusCost`
        // (tournament.prisma). `staffBonus: true` num torneio que não
        // oferece o bônus (`staffBonusCost` nulo) é 400, não um no-op
        // silencioso: o jogador achou que ia pagar por fichas extras.
        if (staffBonus && tournament.staffBonusCost === null) {
          throw new BadRequestException(
            'Este torneio não oferece bônus de staff.',
          );
        }
        const chipStack =
          tournament.startingStack +
          (staffBonus ? (tournament.staffBonusChips ?? 0) : 0);

        const created = await tx.tournamentEntry.create({
          data: {
            // `clubeId` explícito aqui só para o TYPESCRIPT: o `tx` tipado é
            // o `Prisma.TransactionClient` padrão (a extension de
            // `withClube` é invisível para o compilador), então o
            // `TournamentEntryUncheckedCreateInput` exige a coluna mesmo a
            // injeção automática cobrindo o runtime — ver o JSDoc de
            // `clubeScopeExtension` sobre o chokepoint sempre vencer.
            clubeId,
            tournamentId,
            userId,
            status: 'REGISTERED',
            chipStack,
            staffBonusPaid: staffBonus,
          },
        });

        let debit = new Prisma.Decimal(tournament.buyIn).add(tournament.fee);
        let description = 'Inscrição em torneio';
        if (staffBonus) {
          debit = debit.add(tournament.staffBonusCost ?? 0);
          description += ' (+ bônus de staff)';
        }

        const walletTxn = await this.walletService.applyLedgerEntry(
          tx,
          wallet.id,
          {
            type: 'TOURNAMENT_BUY_IN',
            amount: debit.negated(),
            idempotencyKey: ledgerKey,
            description,
            tournamentEntryId: created.id,
          },
        );

        await tx.tournament.update({
          where: { id: tournamentId },
          data: {
            prizePool: { increment: tournament.buyIn },
            // `version` continua subindo: é o carimbo de "mudou" que os
            // leitores usam, mesmo sem servir mais de guarda de concorrência.
            version: { increment: 1 },
          },
        });

        // Plano de assento calculado AQUI DENTRO, sobre o estado lido na
        // própria transação e sob o lock — nunca sobre leitura anterior.
        await this.seatEntry(
          tx,
          tournamentId,
          tournament.tableCapacity,
          created.id,
        );

        return tx.tournamentEntry.update({
          where: { id: created.id },
          data: { buyInTransactionId: walletTxn.id },
          include: ENTRY_INCLUDE,
        });
      });

      return toTournamentEntryDto(entry);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        // Chaves de idempotência DIFERENTES para o mesmo jogador ainda vivo
        // (`tournament_entries_active_user_unique`): aí é 409 de verdade — o
        // replay legítimo já foi resolvido dentro da transação.
        throw new ConflictException('Você já está inscrito neste torneio.');
      }
      throw error;
    }
  }

  /**
   * Cancela a PRÓPRIA inscrição — só antes do torneio começar (`REGISTERING`).
   * Depois disso (`RUNNING`) a ficha já pode ter mudado de mãos na mesa;
   * "desistir" vira uma eliminação de verdade, que é decisão do staff
   * (`eliminateEntry`), não um botão do jogador.
   *
   * Devolve buy-in + fee + bônus de staff (se pago) — reverso exato do
   * débito de `registerEntry`. Não deleta a entry (histórico append-only):
   * vira `REFUNDED`, o mesmo status que a unique parcial
   * (`tournament_entries_active_user_unique`) e a contagem de
   * `previousEntries` já tratam como "não conta" — o jogador pode se
   * inscrever de novo depois, como se fosse a primeira vez.
   */
  async unregisterEntry(
    userId: string,
    clubeId: string,
    tournamentId: string,
    idempotencyKey: string,
  ): Promise<TournamentEntryDto> {
    const ledgerKey = `tournament-refund:${idempotencyKey}`;

    const replay = await findReplay(this.prisma, clubeId, ledgerKey);
    if (replay) return toTournamentEntryDto(replay);

    const entry = await this.prisma.withClube(clubeId, async (tx) => {
      await lockTournament(tx, clubeId, tournamentId);

      const twin = await findReplay(tx, clubeId, ledgerKey);
      if (twin) return twin;

      const tournament = await tx.tournament.findUniqueOrThrow({
        where: { id: tournamentId },
      });
      if (tournament.status !== 'REGISTERING') {
        throw new BadRequestException(
          'Só é possível cancelar a inscrição antes do torneio começar.',
        );
      }

      const existing = await tx.tournamentEntry.findFirst({
        where: { tournamentId, userId, status: 'REGISTERED' },
      });
      if (!existing) {
        throw new NotFoundException('Você não está inscrito neste torneio.');
      }

      await tx.tournamentSeat.updateMany({
        where: { tournamentEntryId: existing.id, active: true },
        data: { active: false, releasedAt: new Date() },
      });

      const wallet = await tx.wallet.findUniqueOrThrow({
        where: { userId_clubeId: { userId, clubeId } },
      });
      let refund = new Prisma.Decimal(tournament.buyIn).add(tournament.fee);
      let description = 'Cancelamento de inscrição em torneio';
      if (existing.staffBonusPaid) {
        refund = refund.add(tournament.staffBonusCost ?? 0);
        description += ' (+ bônus de staff)';
      }

      await this.walletService.applyLedgerEntry(tx, wallet.id, {
        type: 'TOURNAMENT_REFUND',
        amount: refund,
        idempotencyKey: ledgerKey,
        description,
        tournamentEntryId: existing.id,
      });

      await tx.tournament.update({
        where: { id: tournamentId },
        data: {
          prizePool: { decrement: tournament.buyIn },
          version: { increment: 1 },
        },
      });

      const updated = await tx.tournamentEntry.update({
        where: { id: existing.id },
        data: { status: 'REFUNDED', chipStack: 0 },
        include: ENTRY_INCLUDE,
      });

      // Mesmo pós-processamento de assento de `eliminateEntry`: libera a
      // mesa se ela esvaziou e rebalanceia quem restou, mesmo estando ainda
      // em REGISTERING (o MVP senta o jogador já na inscrição — ver docblock
      // de `registerEntry`).
      const tables = await this.readTables(tx, tournamentId);
      await this.applyMoves(tx, tables, planRebalance(toSnapshots(tables)));
      await closeEmptyTables(tx, tournamentId);

      return updated;
    });

    return toTournamentEntryDto(entry);
  }

  /**
   * ADMIN: marca a eliminação, LIBERA o assento e rebalanceia/quebra mesas
   * (MT-BE-05) — tudo numa transação só, serializada por torneio.
   *
   * Idempotência: reexecutar dá 400 "Inscrição já foi eliminada", como antes.
   * Não há `Idempotency-Key` aqui de propósito — não há dinheiro envolvido e
   * o 400 já é resposta suficiente para o caixa.
   */
  async eliminateEntry(
    clubeId: string,
    tournamentId: string,
    entryId: string,
    dto: EliminateEntryDto,
  ): Promise<TournamentEntryDto> {
    const eliminated = await this.prisma.withClube(clubeId, async (tx) => {
      await lockTournament(tx, clubeId, tournamentId);

      const entry = await tx.tournamentEntry.findUnique({
        where: { id: entryId },
      });
      if (!entry || entry.tournamentId !== tournamentId) {
        throw new NotFoundException('Inscrição não encontrada.');
      }
      if (entry.status === 'ELIMINATED' || entry.status === 'PAID') {
        throw new BadRequestException('Inscrição já foi eliminada.');
      }

      // Desativação, nunca DELETE: a linha vira histórico (append-only).
      await tx.tournamentSeat.updateMany({
        where: { tournamentEntryId: entryId, active: true },
        data: { active: false, releasedAt: new Date() },
      });

      // Primeira eliminação: REGISTERING -> RUNNING (o torneio "começou a
      // jogar") — dentro da mesma transação.
      await tx.tournament.updateMany({
        where: { id: tournamentId, status: 'REGISTERING' },
        data: { status: 'RUNNING' },
      });

      const updated = await tx.tournamentEntry.update({
        where: { id: entryId },
        data: {
          status: 'ELIMINATED',
          eliminatedAt: new Date(),
          finalPosition: dto.finalPosition,
          chipStack: 0,
        },
        include: ENTRY_INCLUDE,
      });

      // Snapshot PÓS-eliminação, como `planRebalance` espera (decisão (f) de
      // seating.ts). Na maioria das eliminações o plano é vazio.
      const tables = await this.readTables(tx, tournamentId);
      await this.applyMoves(tx, tables, planRebalance(toSnapshots(tables)));
      await closeEmptyTables(tx, tournamentId);

      return updated;
    });

    return toTournamentEntryDto(eliminated);
  }

  /**
   * ADMIN: redraw manual (MT-BE-06) — sorteia TODOS os vivos de novo.
   *
   * PERMITIDO COM O RELÓGIO `RUNNING`: quem decide é o diretor do torneio, e
   * exigir pausa só criaria um passo extra que o staff faria errado no meio de
   * um nível. O retorno é o mapa novo, para conferência imediata.
   *
   * Mesas: reaproveita as ABERTAS (mantendo os números impressos nos tickets)
   * e abre novas com `max(tableNumber) + 1` se faltar. Mesa `CLOSED` NUNCA é
   * reaberta — fechar é definitivo (ver `TournamentTable` em
   * tournament.prisma), e o histórico de assentos dela continua consultável.
   */
  async redrawTables(
    adminId: string,
    clubeId: string,
    tournamentId: string,
  ): Promise<TournamentTableMapDto> {
    return this.prisma.withClube(clubeId, async (tx) => {
      await lockTournament(tx, clubeId, tournamentId);

      const tournament = await tx.tournament.findUniqueOrThrow({
        where: { id: tournamentId },
        select: { tableCapacity: true },
      });
      const alive = await tx.tournamentEntry.findMany({
        where: { tournamentId, status: { in: [...ALIVE_STATUSES] } },
        select: { id: true },
        orderBy: { registeredAt: 'asc' },
      });
      if (alive.length === 0) {
        throw new BadRequestException(
          'Nenhum jogador vivo neste torneio para sortear.',
        );
      }

      const tables = await this.readTables(tx, tournamentId);
      const origin = new Map(
        tables.flatMap((table) =>
          table.seats.map((seat) => [
            seat.tournamentEntry.id,
            { tableId: table.id, seatNumber: seat.seatNumber },
          ]),
        ),
      );

      const assignments = planRedraw(
        alive.map((entry) => entry.id),
        tournament.tableCapacity,
      );
      const tableCount = Math.max(...assignments.map((a) => a.tableNumber));

      const open = tables.filter((table) => table.status === 'OPEN');
      let highest = tables.reduce(
        (max, table) => Math.max(max, table.tableNumber),
        0,
      );
      const destinations: string[] = [];
      for (let index = 0; index < tableCount; index += 1) {
        const reused = open[index];
        if (reused) {
          destinations.push(reused.id);
          continue;
        }
        highest += 1;
        const opened = await tx.tournamentTable.create({
          data: {
            tournamentId,
            tableNumber: highest,
            capacity: tournament.tableCapacity,
          },
        });
        destinations.push(opened.id);
      }

      // Solta TODO mundo antes de sentar qualquer um: no redraw um assento de
      // destino é quase sempre um assento de origem de outra pessoa, e o
      // índice parcial `tournament_seats_active_seat_unique` recusaria a
      // sobreposição se as inserções viessem intercaladas.
      const releasedAt = new Date();
      await tx.tournamentSeat.updateMany({
        where: { active: true, tournamentTable: { tournamentId } },
        data: { active: false, releasedAt },
      });

      for (const assignment of assignments) {
        const from = origin.get(assignment.entryId);
        await tx.tournamentSeat.create({
          data: {
            tournamentTableId: destinations[assignment.tableNumber - 1],
            tournamentEntryId: assignment.entryId,
            seatNumber: assignment.seatNumber,
            reason: 'MANUAL_REDRAW',
            fromTableId: from?.tableId ?? null,
            fromSeatNumber: from?.seatNumber ?? null,
            // Ator OBRIGATÓRIO aqui: é o "por quem, se manual" do PRD §5.2.
            movedById: adminId,
          },
        });
      }

      await closeEmptyTables(tx, tournamentId);

      return toTournamentTableMapDto(
        tournamentId,
        await this.readTables(tx, tournamentId),
      );
    });
  }

  /**
   * Mapa de mesas para EXIBIÇÃO pública (MT-BE-08).
   *
   * UMA query: `TABLE_SELECT` já traz assentos ativos + inscrição sentada num
   * select aninhado, e ele sai pendurado no `findUnique` do torneio para que
   * um id inexistente vire 404 sem custar uma segunda ida ao banco.
   *
   * Sem transação de propósito: é leitura para polling de TV, e o snapshot que
   * o Postgres devolve numa query só já é consistente.
   */
  async readPublicTableMap(
    tournamentId: string,
  ): Promise<PublicTournamentTableMapDto> {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: {
        tables: { orderBy: { tableNumber: 'asc' }, select: TABLE_SELECT },
      },
    });
    if (!tournament) throw new NotFoundException('Torneio não encontrado.');

    return toPublicTournamentTableMapDto(tournamentId, tournament.tables);
  }

  /** Mesas do torneio com a ocupação ATIVA. Sempre lida dentro da transação. */
  private readTables(
    tx: Prisma.TransactionClient,
    tournamentId: string,
  ): Promise<TournamentTableRow[]> {
    return tx.tournamentTable.findMany({
      where: { tournamentId },
      orderBy: { tableNumber: 'asc' },
      select: TABLE_SELECT,
    });
  }

  /**
   * Senta uma inscrição recém-criada (inscrição inicial ou reentrada) e, se
   * isso abriu uma mesa nova ao lado de mesas já abertas, rebalanceia — ver o
   * docblock de `registerEntry` sobre a composição das duas funções.
   */
  private async seatEntry(
    tx: Prisma.TransactionClient,
    tournamentId: string,
    tableCapacity: number,
    entryId: string,
  ): Promise<void> {
    const tables = await this.readTables(tx, tournamentId);
    const plan = planInitialSeat(toSnapshots(tables), tableCapacity);

    let tableId = tables.find(
      (table) => table.tableNumber === plan.tableNumber,
    )?.id;
    if (plan.openNewTable) {
      const opened = await tx.tournamentTable.create({
        data: {
          tournamentId,
          tableNumber: plan.tableNumber,
          capacity: plan.capacity,
        },
      });
      tableId = opened.id;
    }

    await tx.tournamentSeat.create({
      data: {
        tournamentTableId: tableId!,
        tournamentEntryId: entryId,
        seatNumber: plan.seatNumber,
        reason: 'INITIAL',
      },
    });

    if (plan.openNewTable && tables.some((table) => table.status === 'OPEN')) {
      const after = await this.readTables(tx, tournamentId);
      await this.applyMoves(tx, after, planRebalance(toSnapshots(after)));
    }
  }

  /**
   * Aplica os `Move`s do planejador: cada um vira desativar a linha corrente +
   * INSERT da nova (append-only). SEQUENCIAL e na ordem do plano de propósito
   * — é a mesma ordem em que o planejador mutou o estado dele, então um
   * destino que só ficou livre por causa de um move anterior já está livre
   * quando chega a vez dele.
   */
  private async applyMoves(
    tx: Prisma.TransactionClient,
    tables: TournamentTableRow[],
    moves: Move[],
    movedById: string | null = null,
  ): Promise<void> {
    if (moves.length === 0) return;

    const tableIds = new Map(
      tables.map((table) => [table.tableNumber, table.id]),
    );
    const releasedAt = new Date();

    for (const move of moves) {
      await tx.tournamentSeat.updateMany({
        where: { tournamentEntryId: move.entryId, active: true },
        data: { active: false, releasedAt },
      });
      await tx.tournamentSeat.create({
        data: {
          tournamentTableId: tableIds.get(move.toTable)!,
          tournamentEntryId: move.entryId,
          seatNumber: move.toSeat,
          reason: move.reason,
          fromTableId: tableIds.get(move.fromTable) ?? null,
          fromSeatNumber: move.fromSeat,
          movedById,
        },
      });
    }
  }

  /** Níveis do preset prontos para o nested `create` — 404 se ele não existe. */
  private async copyBlindLevels(
    blindStructureId: string | undefined,
  ): Promise<Prisma.TournamentBlindLevelCreateWithoutTournamentInput[]> {
    if (!blindStructureId) return [];

    const structure = await this.prisma.blindStructure.findUnique({
      where: { id: blindStructureId },
      include: { levels: { orderBy: { levelNumber: 'asc' } } },
    });
    if (!structure) {
      throw new NotFoundException('Estrutura de blinds não encontrada.');
    }

    return structure.levels.map((level) => ({
      levelNumber: level.levelNumber,
      smallBlind: level.smallBlind,
      bigBlind: level.bigBlind,
      ante: level.ante,
      durationSeconds: level.durationSeconds,
      isBreak: level.isBreak,
      breakLabel: level.breakLabel,
    }));
  }

  /**
   * Encerra o torneio e paga a grade. A colocação de 1º lugar é inferida
   * automaticamente quando não foi marcada manualmente: se sobrar
   * EXATAMENTE uma inscrição ainda não eliminada, ela é o campeão. Qualquer
   * outra posição premiada exige `finalPosition` já registrado via
   * `eliminateEntry` — este MVP não infere colocações intermediárias sozinho.
   */
  async finishTournament(
    clubeId: string,
    tournamentId: string,
  ): Promise<TournamentDetailResponse> {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId, clubeId },
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
      where: { tournamentId, clubeId },
    });

    // Mesma definição de "ainda em jogo" usada no cap de vagas em
    // `registerEntry` (`ALIVE_STATUSES`) — era uma lista de exclusão própria
    // aqui (`!== 'ELIMINATED' && !== 'PAID'`) que ficou pra trás quando
    // `REFUNDED` (cancelamento de inscrição) foi introduzido: uma inscrição
    // cancelada contava como "ainda ativa" e travava o encerramento sozinha.
    const remaining = entries.filter((e) =>
      (ALIVE_STATUSES as readonly string[]).includes(e.status),
    );

    // Todo mundo cancelou antes do torneio rodar (torneio que não chegou a
    // acontecer): sem campeão e sem prêmio a pagar — cada `unregisterEntry`
    // já devolveu o buyIn ao `prizePool` (decrement), então não sobra
    // dinheiro pra distribuir. Encerra direto, sem passar pelo cálculo de
    // payout abaixo (que exigiria uma colocação que nunca vai existir).
    //
    // DIFERENTE de "todo mundo foi ELIMINATED sem sobrar campeão" (bug real —
    // o último remanescente deveria ter sido inferido campeão, não
    // eliminado): esse caso NÃO cai aqui (`every` exige só REFUNDED) e segue
    // pro fluxo normal, que barra com "Nenhuma inscrição com
    // finalPosition=1" em vez de fechar em silêncio um torneio com prêmio
    // não pago.
    if (entries.length > 0 && entries.every((e) => e.status === 'REFUNDED')) {
      await this.prisma.withClube(clubeId, async (tx) => {
        await lockTournament(tx, clubeId, tournamentId);
        await tx.tournament.update({
          where: { id: tournamentId },
          data: { status: 'FINISHED', finishedAt: new Date() },
        });
      });
      return this.getTournament(clubeId, tournamentId);
    }

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

    await this.prisma.withClube(clubeId, async (tx) => {
      // Mesma ORDEM DE LOCKS de `registerEntry` (torneio → wallet). Sem isto,
      // um encerramento concorrente com uma inscrição de última hora fecharia
      // um ciclo torneio↔wallet e o Postgres abortaria uma das duas por
      // deadlock. Serializa também dois `finish` simultâneos.
      await lockTournament(tx, clubeId, tournamentId);

      for (const payout of payouts) {
        const entry = byPosition.get(payout.position)!;
        const wallet = await tx.wallet.findUniqueOrThrow({
          where: { userId_clubeId: { userId: entry.userId, clubeId } },
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

    return this.getTournament(clubeId, tournamentId);
  }
}

/**
 * Ticket já emitido para esta `Idempotency-Key`, se existir. O
 * `WalletTransaction` é a âncora (é ele que carrega a chave `@unique`, fonte
 * de verdade do replay — MT-003 item 4) e o `include` do assento é
 * obrigatório: sem ele o replay devolveria `tableNumber: null` e o caixa
 * reimprimiria um ticket vazio.
 *
 * Recebe o client como parâmetro para servir aos DOIS pontos de checagem: o
 * caminho rápido, fora da transação, e a reconferência sob o lock.
 */
async function findReplay(
  client: Prisma.TransactionClient,
  clubeId: string,
  ledgerKey: string,
): Promise<Prisma.TournamentEntryGetPayload<{
  include: typeof ENTRY_INCLUDE;
}> | null> {
  const existingTxn = await client.walletTransaction.findUnique({
    where: { idempotencyKey: ledgerKey },
  });
  if (!existingTxn?.tournamentEntryId) return null;

  // `clubeId` explícito no `where` (e não só a injeção automática de
  // `withClube`): o caminho rápido acima roda com `this.prisma` PLANO, fora
  // de qualquer transação escopada, e sem isto um `idempotencyKey` colidindo
  // por acaso entre clubes devolveria a entry de outro tenant.
  return client.tournamentEntry.findUnique({
    where: { id: existingTxn.tournamentEntryId, clubeId },
    include: ENTRY_INCLUDE,
  });
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

/**
 * Serializa as operações de assento de UM torneio. Pessimista, e não o lock
 * otimista de `version`: duas eliminações concorrentes produzem planos de
 * movimentação incompatíveis, e refazer N moves em retry é caro e propenso a
 * laço — o mesmo trade-off que motivou o pessimista na wallet.
 *
 * // ponytail: lock por torneio; particionar por mesa se throughput de
 * // eliminações crescer muito.
 */
async function lockTournament(
  tx: Prisma.TransactionClient,
  clubeId: string,
  tournamentId: string,
): Promise<void> {
  // `$queryRaw` NÃO passa pela extension de `withClube` (só métodos
  // tipados passam — ver docblock de `PrismaService.withClube`), então o
  // filtro de `clube_id` vai aqui à mão: sem ele, o lock pegaria (e o
  // `rows.length` confirmaria a existência de) um torneio de OUTRO clube
  // pelo id — um IDOR que o RLS de produção cobriria, mas que esta camada
  // não deve depender dele para recusar.
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM tournaments
    WHERE id = ${tournamentId} AND clube_id = ${clubeId}
    FOR UPDATE
  `;
  if (rows.length === 0) throw new NotFoundException('Torneio não encontrado.');
}

/** Mesa sem ninguém sentado não recebe mais ninguém: fechar é definitivo. */
async function closeEmptyTables(
  tx: Prisma.TransactionClient,
  tournamentId: string,
): Promise<void> {
  await tx.tournamentTable.updateMany({
    where: {
      tournamentId,
      status: 'OPEN',
      seats: { none: { active: true } },
    },
    data: { status: 'CLOSED' },
  });
}

/** Linhas do banco → o snapshot puro que `seating.ts` consome. */
function toSnapshots(tables: TournamentTableRow[]): TableSnapshot[] {
  return tables.map((table) => ({
    tableNumber: table.tableNumber,
    capacity: table.capacity,
    isOpen: table.status === 'OPEN',
    seats: table.seats.map((seat) => ({
      entryId: seat.tournamentEntry.id,
      seatNumber: seat.seatNumber,
    })),
  }));
}

/**
 * Porta de entrada da inscrição (MT-BE-04) e da reentrada (MT-BE-09).
 *
 * `previousEntries > 0` ⇒ é reentrada: o índice parcial
 * `tournament_entries_active_user_unique` garante que nenhuma delas está viva,
 * então o que resta validar é a POLÍTICA — o torneio permite? quantas já
 * foram? o relógio ainda está dentro da janela? `maxReentries` conta
 * REENTRADAS, não inscrições: com `maxReentries = 1` o jogador entra duas
 * vezes no total.
 */
function assertRegistrationAllowed(
  tournament: {
    status: string;
    allowReentry: boolean;
    maxReentries: number | null;
    reentryUntilLevel: number | null;
    currentLevelNumber: number | null;
    lateRegUntil: Date | null;
  },
  previousEntries: number,
  now: Date,
): void {
  const isReentry = previousEntries > 0;

  if (isReentry) {
    if (!tournament.allowReentry) {
      throw new BadRequestException('Este torneio não permite reentrada.');
    }
    if (
      tournament.maxReentries !== null &&
      previousEntries > tournament.maxReentries
    ) {
      throw new BadRequestException(
        `Limite de ${tournament.maxReentries} reentrada(s) por jogador já atingido.`,
      );
    }
  }

  // Reentrada em torneio já RUNNING é o caso NORMAL (o jogador só reentra
  // depois de ser eliminado, e a primeira eliminação já mudou o status).
  // Inscrição NOVA em torneio RUNNING é "late registration": só entra dentro
  // de `lateRegUntil` (nulo = torneio não admite tardia, ver docblock do
  // campo em tournament.prisma) — reentrada não passa por este relógio, só
  // pelo corte de nível abaixo, igual sempre foi.
  const open =
    tournament.status === 'REGISTERING' ||
    (tournament.status === 'RUNNING' &&
      (isReentry ||
        (tournament.lateRegUntil !== null && now <= tournament.lateRegUntil)));
  if (!open) {
    throw new BadRequestException(
      'Inscrições não estão abertas para este torneio.',
    );
  }

  // Corte por NÍVEL: mesmo campo (`reentryUntilLevel`) fecha tanto reentrada
  // quanto inscrição nova tardia — na mesa, "late reg" e "re-entry" fecham no
  // mesmo instante/nível, é uma janela só.
  if (
    tournament.status === 'RUNNING' &&
    tournament.reentryUntilLevel !== null &&
    tournament.currentLevelNumber !== null &&
    tournament.currentLevelNumber > tournament.reentryUntilLevel
  ) {
    throw new BadRequestException(
      `Inscrições encerradas — o torneio passou do nível ${tournament.reentryUntilLevel}.`,
    );
  }
}

/**
 * Configuração de reentrada coerente (MT-BE-03). Recebe só os 3 campos que
 * lê — na criação é o `CreateTournamentDto` inteiro (satisfaz o `Pick` por
 * estrutura); na edição (`updateTournament`) é o ESTADO EFETIVO mesclado
 * (patch sobre o que já está gravado), não o patch isolado — um PATCH que só
 * manda `reentryUntilLevel` sem tocar `allowReentry` precisa ser validado
 * contra o `allowReentry` que já está no banco, não contra `undefined`.
 */
function assertCoherentReentryConfig(
  dto: Pick<
    CreateTournamentDto,
    'allowReentry' | 'maxReentries' | 'reentryUntilLevel'
  >,
  levelCount: number,
): void {
  if (
    !dto.allowReentry &&
    (dto.maxReentries !== undefined || dto.reentryUntilLevel !== undefined)
  ) {
    throw new BadRequestException(
      'maxReentries/reentryUntilLevel exigem allowReentry = true.',
    );
  }
  if (
    dto.reentryUntilLevel !== undefined &&
    levelCount > 0 &&
    dto.reentryUntilLevel > levelCount
  ) {
    throw new BadRequestException(
      `reentryUntilLevel (${dto.reentryUntilLevel}) está fora da estrutura de blinds, que tem ${levelCount} níveis.`,
    );
  }
}

/**
 * Espelha o CHECK `tournaments_staff_bonus_coherent` (migration
 * `add_staff_bonus`) com uma mensagem amigável: custo e fichas do bônus de
 * staff andam juntos, um sem o outro não faz sentido. Mesma nota de
 * `assertCoherentReentryConfig` sobre criação vs. edição (estado efetivo).
 */
function assertCoherentStaffBonusConfig(
  dto: Pick<CreateTournamentDto, 'staffBonusCost' | 'staffBonusChips'>,
): void {
  const hasCost = dto.staffBonusCost !== undefined;
  const hasChips = dto.staffBonusChips !== undefined;
  if (hasCost !== hasChips) {
    throw new BadRequestException(
      'staffBonusCost e staffBonusChips precisam vir juntos, ou nenhum dos dois.',
    );
  }
}

/**
 * Grade de premiação válida: soma dos percentuais fecha 100.00 e posições
 * não se repetem. Regra sobre o CONJUNTO de linhas — um `@Matches` de campo
 * único (no DTO) não expressa isso. Compartilhada por `createTournament` e
 * `updateTournament`.
 */
function assertValidPrizeGrade(
  prizes: Array<{ position: number; percentage: string }>,
): void {
  const sum = prizes.reduce(
    (total, prize) => total.add(new Prisma.Decimal(prize.percentage)),
    new Prisma.Decimal(0),
  );
  if (sum.minus(ONE_HUNDRED).abs().greaterThan(PERCENTAGE_TOLERANCE)) {
    throw new BadRequestException(
      `A soma dos percentuais da grade de premiação deve ser 100.00 (atual: ${sum.toFixed(2)}).`,
    );
  }
  const positions = prizes.map((p) => p.position);
  if (new Set(positions).size !== positions.length) {
    throw new BadRequestException(
      'Colocações da grade de premiação não podem se repetir.',
    );
  }
}
