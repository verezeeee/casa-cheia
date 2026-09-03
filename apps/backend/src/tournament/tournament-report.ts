import type {
  TournamentEntryStatus as SharedTournamentEntryStatus,
  TournamentStatus as SharedTournamentStatus,
  TournamentReportRankingItemDto,
  TournamentReportResponse,
  TournamentReportStatsDto,
} from '@poker-system/shared';
import { Prisma } from '../generated/prisma';
import type {
  Tournament,
  TournamentEntry,
  TournamentPrize,
} from '../generated/prisma';
import { toMoney, toTournamentPrizeDto } from './tournament.mappers';

/**
 * RT-BE-02 — Relatório de fechamento de torneio, como FUNÇÃO PURA.
 *
 * Zero I/O, zero Prisma Client, zero `new Date()`: as linhas já vêm carregadas
 * pelo chamador (`TournamentService.getReport`, RT-BE-03) e o instante de
 * geração entra por parâmetro. Mesmo padrão e mesma motivação de `seating.ts`:
 * aqui mora TODO o risco de regra do relatório (posição derivada, aritmética de
 * dinheiro, reentrada), e é a única peça testável exaustivamente sem Postgres.
 * O e2e (`RT-QA-02`) confere a montagem da consulta; a CORREÇÃO dos números é
 * responsabilidade exclusiva deste arquivo e do seu `tournament-report.spec.ts`.
 *
 * ---------------------------------------------------------------------------
 * O RELATÓRIO NÃO CORRIGE O BANCO
 * ---------------------------------------------------------------------------
 * Nenhum caminho deste arquivo lança exceção. Um `finalPosition` duplicado ou
 * fora da faixa de inscritos é dado SUJO gravado por um humano no calor do
 * torneio, e o relatório é o documento que o denuncia — se ele explodisse, o
 * clube perderia o único jeito de descobrir que a planilha da noite está
 * errada. Por isso: preserva-se o que está gravado (`positionSource:
 * 'RECORDED'`), e o cálculo das posições livres simplesmente ocupa o que
 * sobrar (podendo ultrapassar N quando há posição repetida).
 *
 * ---------------------------------------------------------------------------
 * DINHEIRO SÓ EM `Prisma.Decimal`
 * ---------------------------------------------------------------------------
 * Toda a aritmética acontece em `Prisma.Decimal` e a conversão para string
 * (`toMoney`) só acontece na MONTAGEM DO DTO, na última linha de cada campo.
 * Não existe `Number(...)` em cima de valor monetário em nenhum ponto — é a
 * regra de ouro de `MoneyString` (packages/shared/src/types/money.ts), e ela
 * importa especialmente aqui: `unpaidPrizePool` é uma SUBTRAÇÃO de somas de
 * centavos, exatamente a conta em que `number` acumula erro de IEEE-754 e
 * inventa uma sobra de prize pool que não existe.
 */

/**
 * Colunas do torneio que o relatório consome. `Pick` em vez de um shape
 * próprio para que uma renomeação no schema quebre a compilação aqui, e não
 * silenciosamente em runtime.
 */
export type TournamentReportSource = Pick<
  Tournament,
  | 'id'
  | 'name'
  | 'status'
  | 'buyIn'
  | 'fee'
  | 'staffBonusCost'
  | 'startsAt'
  | 'startedAt'
  | 'finishedAt'
  | 'prizePool'
  | 'guaranteedPrize'
  | 'currentLevelNumber'
>;

/**
 * Uma inscrição como o relatório precisa dela: as colunas de colocação,
 * dinheiro e carimbos, mais o nome do jogador (o chamador faz o `include` do
 * `user` — quem monta a query é quem sabe se está dentro de uma transação).
 */
export type TournamentReportEntrySource = Pick<
  TournamentEntry,
  | 'id'
  | 'userId'
  | 'status'
  | 'staffBonusPaid'
  | 'finalPosition'
  | 'prizeAmount'
  | 'registeredAt'
  | 'eliminatedAt'
> & { user: { name: string } };

/** Faixa da grade de premiação (só os campos que viram `TournamentPrizeDto`). */
export type TournamentReportPrizeSource = Pick<
  TournamentPrize,
  'position' | 'percentage'
>;

/** Zero monetário: acumulador inicial das somas e piso do `overlay`. */
const ZERO = new Prisma.Decimal(0);

/**
 * Ordem de INSCRIÇÃO, com `id` como desempate final.
 *
 * O desempate por `id` não é decoração: ele é o que torna "a entrada mais
 * antiga daquele jogador" um conceito TOTAL. Duas inscrições do mesmo usuário
 * podem cair no mesmo milissegundo (`registered_at` vem de `now()` do banco, e
 * um duplo-clique cabe dentro do mesmo tick); sem um critério que sempre
 * decide, existiriam duas "mais antigas" e `isReentry` marcaria 0 ou 2 linhas —
 * divergindo de `reentries`, que é uma contagem.
 */
function byRegistration(
  a: TournamentReportEntrySource,
  b: TournamentReportEntrySource,
): number {
  return (
    a.registeredAt.getTime() - b.registeredAt.getTime() ||
    a.id.localeCompare(b.id)
  );
}

/**
 * Ordem em que as posições AINDA LIVRES são distribuídas entre as inscrições
 * sem `finalPosition` gravado — do melhor colocado para o pior:
 *
 *   1. Quem NÃO tem `eliminatedAt` primeiro. São os jogadores que chegaram ao
 *      fim de pé: o campeão (que nunca é "eliminado" — ver `eliminateEntry`) e,
 *      num torneio `CANCELLED`, todo mundo que continuava `REGISTERED`. Ficar
 *      atrás de quem foi eliminado colocaria o campeão em último lugar.
 *   2. `eliminatedAt` DESCENDENTE: quem cai por último dura mais e fica melhor
 *      colocado. É a única informação de mérito que o banco tem quando o staff
 *      não digitou a colocação (só as faixas premiadas exigem `finalPosition`).
 *   3. `registeredAt` ascendente e `id` — desempate puro, sem semântica de
 *      mérito, apenas para o relatório ser reproduzível byte a byte entre duas
 *      gerações do mesmo torneio.
 *
 * `Infinity` como carimbo de quem não foi eliminado faz a regra 1 cair como
 * caso particular da regra 2 (ninguém "cai depois" de quem nunca caiu), em vez
 * de virar um par de `if`s de nulidade antes da comparação. O `if (aOut !==
 * bOut)` existe porque `Infinity - Infinity` é `NaN`, e um comparador que
 * devolve `NaN` embaralha o array em silêncio.
 */
function byDerivedRank(
  a: TournamentReportEntrySource,
  b: TournamentReportEntrySource,
): number {
  const aOut =
    a.eliminatedAt === null
      ? Number.POSITIVE_INFINITY
      : a.eliminatedAt.getTime();
  const bOut =
    b.eliminatedAt === null
      ? Number.POSITIVE_INFINITY
      : b.eliminatedAt.getTime();
  if (aOut !== bOut) return bOut - aOut;
  return byRegistration(a, b);
}

/** Posição efetiva de uma inscrição e de onde ela veio. */
interface ResolvedPosition {
  readonly position: number;
  readonly source: TournamentReportRankingItemDto['positionSource'];
}

/**
 * Resolve a colocação de cada inscrição do universo do ranking.
 *
 * `finalPosition` gravado vence SEMPRE (`RECORDED`), inclusive sujo. As demais
 * recebem, na ordem de `byDerivedRank`, as posições de `1..N` que sobraram
 * (`DERIVED`) — o cursor é monotônico e cada valor é consumido uma única vez,
 * o que garante por construção que duas linhas `DERIVED` nunca compartilham
 * posição e que nenhuma posição livre fica para trás.
 */
function resolvePositions(
  field: readonly TournamentReportEntrySource[],
): Map<string, ResolvedPosition> {
  const positions = new Map<string, ResolvedPosition>();
  const taken = new Set<number>();

  for (const entry of field) {
    if (entry.finalPosition !== null) {
      positions.set(entry.id, {
        position: entry.finalPosition,
        source: 'RECORDED',
      });
      taken.add(entry.finalPosition);
    }
  }

  const pending = field
    .filter((entry) => entry.finalPosition === null)
    .sort(byDerivedRank);

  let cursor = 1;
  for (const entry of pending) {
    // Salta o que o staff já ocupou. Com posição gravada fora de `1..N` (dado
    // sujo), o cursor pode terminar acima de N — preferível a renumerar o que
    // o humano registrou.
    while (taken.has(cursor)) cursor += 1;
    positions.set(entry.id, { position: cursor, source: 'DERIVED' });
    cursor += 1;
  }

  return positions;
}

/**
 * Monta o relatório de fechamento de um torneio a partir das linhas de origem.
 *
 * @param tournament Torneio (`FINISHED` ou `CANCELLED` — a guarda de status é
 *   do chamador, `RT-002`).
 * @param prizes Grade de premiação configurada. Reordenada por `position` aqui
 *   mesmo, para o contrato do DTO ("em `position` ascendente") não depender do
 *   `orderBy` de quem chamou.
 * @param entries TODAS as inscrições do torneio, inclusive as `REFUNDED` — é
 *   este arquivo que decide o que cada uma faz no relatório.
 * @param tablesUsed Mesas montadas, INCLUINDO as fechadas (histórico, não
 *   estado). `0` em torneios anteriores ao MVP de mesas.
 * @param now Instante da geração (`generatedAt`).
 */
export function buildTournamentReport(
  tournament: TournamentReportSource,
  prizes: readonly TournamentReportPrizeSource[],
  entries: readonly TournamentReportEntrySource[],
  tablesUsed: number,
  now: Date,
): TournamentReportResponse {
  // UNIVERSO DO RANKING: tudo que não foi reembolsado. `unregisterEntry`
  // devolve `buyIn + fee (+ staffBonus)` e DECREMENTA o prize pool, então uma
  // inscrição cancelada não disputou colocação, não gerou receita e não compõe
  // o field — ela só aparece na contagem `refundedEntries`. Este é o mesmo
  // recorte usado por `getTournament` em `_count.entries`.
  const field = entries.filter((entry) => entry.status !== 'REFUNDED');
  const refundedEntries = entries.length - field.length;

  // A entrada mais antiga de cada jogador DENTRO DO FIELD. Duas coisas saem
  // daqui, e é de propósito que saiam do mesmo lugar: `uniquePlayers` (o
  // tamanho do mapa) e o conjunto das inscrições que NÃO são reentrada. Assim
  // `reentries = totalEntries - uniquePlayers` é, por construção, exatamente a
  // quantidade de linhas com `isReentry: true` — os dois números não podem
  // divergir na tela.
  //
  // O universo é o field, não `entries`: quem se inscreveu, cancelou e se
  // inscreveu de novo pagou UMA entrada, não duas. Contar a cancelada como
  // "primeira" marcaria a inscrição válida como reentrada e produziria
  // `reentries: 1` num torneio em que ninguém reentrou.
  const firstEntryByUser = new Map<string, TournamentReportEntrySource>();
  for (const entry of field) {
    const current = firstEntryByUser.get(entry.userId);
    if (current === undefined || byRegistration(entry, current) < 0) {
      firstEntryByUser.set(entry.userId, entry);
    }
  }
  const firstEntryIds = new Set(
    [...firstEntryByUser.values()].map((entry) => entry.id),
  );

  const totalEntries = field.length;
  const uniquePlayers = firstEntryByUser.size;
  // Bônus de staff pago pelas inscrições que FICARAM: o cancelamento devolve o
  // bônus junto com o buy-in (`unregisterEntry`), então contá-lo aqui inflaria
  // `staffBonusRevenue` com dinheiro que já voltou para a wallet do jogador.
  const staffBonusesPaid = field.filter((entry) => entry.staffBonusPaid).length;

  // `buyIn`/`fee`/`staffBonusCost` são IMUTÁVEIS depois da primeira inscrição
  // (`updateTournament` recusa a alteração), e é só por isso que a receita pode
  // ser uma multiplicação: não existe — nem precisa existir — histórico de
  // quanto cada entrada custou.
  const feeRevenue = tournament.fee.times(totalEntries);
  const staffBonusRevenue = (tournament.staffBonusCost ?? ZERO).times(
    staffBonusesPaid,
  );
  // O buy-in NUNCA entra: ele é dos jogadores, está no prize pool.
  const houseRevenue = feeRevenue.add(staffBonusRevenue);

  const totalPaidOut = field.reduce(
    (total, entry) => total.add(entry.prizeAmount ?? ZERO),
    ZERO,
  );
  // Sobra positiva não é erro de conta deste arquivo: é o sintoma de grade
  // incompleta (percentuais que não somam 100%) ou de faixa premiada sem
  // colocação registrada. O relatório existe para mostrá-la.
  const unpaidPrizePool = tournament.prizePool.minus(totalPaidOut);

  // OVERLAY — CAMPO INFORMATIVO. `finishTournament` paga apenas
  // `prizePool × percentage` e ignora `guaranteedPrize`, então overlay > 0
  // significa que os jogadores receberam menos do que o anunciado. Lacuna real,
  // deixada EXPOSTA de propósito e não corrigida aqui (mudar o payout afeta
  // torneios já pagos — decisão financeira própria).
  const guaranteedGap = tournament.guaranteedPrize?.minus(tournament.prizePool);
  const overlay =
    guaranteedGap === undefined
      ? null
      : Prisma.Decimal.max(ZERO, guaranteedGap);

  // DURAÇÃO. `startedAt` é a hora REAL de início (RT-DB-01); `startsAt` é o
  // AGENDADO e só entra como último recurso — num torneio que atrasou 40min
  // para começar, a duração fica 40min maior do que foi, e é exatamente por
  // isso que `durationEstimated` viaja junto para a tela rotular o número.
  const durationEstimated = tournament.startedAt === null;
  const startReference = tournament.startedAt ?? tournament.startsAt;
  // Clamp em 0: o CHECK `tournaments_finished_after_started` só cobre o par
  // `startedAt`/`finishedAt`. Um torneio criado com `startsAt` no futuro e
  // encerrado antes da hora marcada (cancelamento antecipado sem `startedAt`)
  // produziria duração negativa — número sem significado, pior que zero.
  const durationMs =
    tournament.finishedAt === null
      ? null
      : Math.max(0, tournament.finishedAt.getTime() - startReference.getTime());

  const stats: TournamentReportStatsDto = {
    totalEntries,
    uniquePlayers,
    reentries: totalEntries - uniquePlayers,
    refundedEntries,
    staffBonusesPaid,
    tablesUsed,
    // Último nível CONHECIDO do relógio. `currentLevelNumber` é nulo enquanto
    // `NOT_STARTED` e, depois de `FINISHED`, guarda o nível em que o relógio
    // parou — é o "até onde o torneio chegou" (ver `advanceClockToNow`).
    lastLevelNumber: tournament.currentLevelNumber,
    prizePool: toMoney(tournament.prizePool),
    totalPaidOut: toMoney(totalPaidOut),
    unpaidPrizePool: toMoney(unpaidPrizePool),
    guaranteedPrize:
      tournament.guaranteedPrize === null
        ? null
        : toMoney(tournament.guaranteedPrize),
    overlay: overlay === null ? null : toMoney(overlay),
    feeRevenue: toMoney(feeRevenue),
    staffBonusRevenue: toMoney(staffBonusRevenue),
    houseRevenue: toMoney(houseRevenue),
    startedAt: tournament.startedAt?.toISOString() ?? null,
    finishedAt: tournament.finishedAt?.toISOString() ?? null,
    durationMs,
    durationEstimated,
  };

  const positions = resolvePositions(field);
  const ranking: TournamentReportRankingItemDto[] = field
    .map((entry) => {
      // Presente para todo `entry` de `field` por construção de
      // `resolvePositions` (ela itera o mesmo array).
      const resolved = positions.get(entry.id)!;
      return {
        entryId: entry.id,
        userId: entry.userId,
        userName: entry.user.name,
        position: resolved.position,
        positionSource: resolved.source,
        finalPosition: entry.finalPosition,
        // `=== null` e não truthiness: prêmio de `0.00` (faixa com percentual
        // zero) é um prêmio pago de zero, não "fora da faixa premiada".
        prizeAmount:
          entry.prizeAmount === null ? null : toMoney(entry.prizeAmount),
        // Mesmos literais em Prisma e @poker-system/shared (ver base.prisma).
        status: entry.status as unknown as SharedTournamentEntryStatus,
        registeredAt: entry.registeredAt.toISOString(),
        eliminatedAt: entry.eliminatedAt?.toISOString() ?? null,
        staffBonusPaid: entry.staffBonusPaid,
        isReentry: !firstEntryIds.has(entry.id),
      };
    })
    // `position` ascendente. O desempate por `entryId` só é alcançado com
    // `finalPosition` duplicado no banco (posições `DERIVED` são únicas por
    // construção) e existe para que o dado sujo saia sempre na mesma ordem,
    // em vez de depender da ordem de chegada da consulta.
    .sort(
      (a, b) => a.position - b.position || a.entryId.localeCompare(b.entryId),
    );

  return {
    tournamentId: tournament.id,
    name: tournament.name,
    // Mesmos literais em Prisma e @poker-system/shared (ver base.prisma).
    status: tournament.status as unknown as SharedTournamentStatus,
    buyIn: toMoney(tournament.buyIn),
    fee: toMoney(tournament.fee),
    staffBonusCost:
      tournament.staffBonusCost === null
        ? null
        : toMoney(tournament.staffBonusCost),
    startsAt: tournament.startsAt.toISOString(),
    stats,
    prizes: [...prizes]
      .sort((a, b) => a.position - b.position)
      .map(toTournamentPrizeDto),
    ranking,
    generatedAt: now.toISOString(),
  };
}
