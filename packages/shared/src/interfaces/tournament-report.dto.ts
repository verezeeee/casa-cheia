import { TournamentEntryStatus } from '../enums/tournament-entry-status.enum';
import { TournamentStatus } from '../enums/tournament-status.enum';
import { TournamentPrizeDto } from './tournament-detail-response.interface';
import { MoneyString } from '../types/money';

/**
 * Origem da colocação exibida no ranking do relatório.
 *
 * - `RECORDED`: o staff digitou `finalPosition` no momento da eliminação
 *   (`eliminateEntry`). É o dado gravado no banco e vence sempre — inclusive
 *   quando está sujo (posição duplicada ou fora da faixa de inscritos): o
 *   relatório preserva o que o staff registrou em vez de "corrigir".
 * - `DERIVED`: a colocação foi inferida pela ordem de eliminação
 *   (`eliminatedAt` decrescente — quem cai por último fica melhor colocado).
 *   Só as faixas premiadas exigem `finalPosition`, então a maioria das
 *   colocações de um torneio real nasce aqui. NÃO fica gravada em lugar
 *   nenhum: é calculada a cada geração do relatório.
 *
 * Union de literais em vez de `enum` de propósito: ao contrário dos demais
 * enums deste pacote, este não espelha nenhum enum do schema Prisma.
 */
export type PositionSource = 'RECORDED' | 'DERIVED';

/** Uma linha do ranking final do relatório — uma entrada (`TournamentEntry`), não um jogador. */
export interface TournamentReportRankingItemDto {
  entryId: string;

  userId: string;

  userName: string;

  /**
   * Colocação efetiva usada para ordenar o ranking (1-based). Livre de
   * repetição entre as linhas `DERIVED`; ver `positionSource` para a ressalva
   * sobre dados sujos em `RECORDED`.
   */
  position: number;

  positionSource: PositionSource;

  /**
   * Colocação como está GRAVADA no banco; `null` quando o staff não a
   * informou na eliminação (ou quando o jogador nunca foi eliminado — o
   * campeão não recebe `finalPosition` automaticamente). Exposta ao lado de
   * `position` para que a tela consiga distinguir o registrado do inferido.
   */
  finalPosition: number | null;

  /** Prêmio creditado na Wallet; `null` fora da faixa premiada. */
  prizeAmount: MoneyString | null;

  /**
   * Status da entrada. Nunca `REFUNDED` aqui: inscrições canceladas ficam
   * FORA do ranking (só aparecem em `TournamentReportStatsDto.refundedEntries`),
   * porque devolveram buy-in + fee e não disputaram colocação.
   */
  status: TournamentEntryStatus;

  /** ISO 8601 UTC. */
  registeredAt: string;

  /** ISO 8601 UTC; `null` para quem não foi eliminado (o campeão, tipicamente). */
  eliminatedAt: string | null;

  /** Se esta entrada pagou o bônus de staff opt-in (`Tournament.staffBonusCost`). */
  staffBonusPaid: boolean;

  /**
   * `true` quando esta NÃO é a entrada mais antiga do mesmo `userId` neste
   * torneio — ou seja, é uma REENTRADA.
   *
   * Não existe rebuy nem add-on como produto neste domínio: o que existe é
   * reentrada (`allowReentry`/`maxReentries`), e cada reentrada é um
   * `TournamentEntry` novo, com buy-in e fee próprios. Por isso o relatório
   * conta entradas, não "rebuys".
   */
  isReentry: boolean;
}

/**
 * Números consolidados do torneio, todos derivados das linhas de origem
 * (`Tournament` + `TournamentEntry` + `TournamentPrize` + `TournamentTable`)
 * no momento da consulta — não há snapshot materializado (ver `RT-000`).
 * Depois de `FINISHED`/`CANCELLED` essas linhas são imutáveis, então o
 * relatório é estável.
 *
 * Toda a aritmética monetária acontece no backend em `Prisma.Decimal`; aqui
 * os valores já chegam como `MoneyString` para exibição.
 */
export interface TournamentReportStatsDto {
  /** Inscrições que disputaram (exclui `REFUNDED`) — o "field" do torneio. */
  totalEntries: number;

  /** `userId` distintos entre as `totalEntries`. */
  uniquePlayers: number;

  /**
   * `totalEntries - uniquePlayers`.
   *
   * Esta é a estatística correta de "quantas vezes se pagou entrada além da
   * primeira" neste domínio, justamente porque rebuy/add-on não existem como
   * produto: só reentrada, 1 `TournamentEntry` por entrada.
   */
  reentries: number;

  /**
   * Inscrições com `status === 'REFUNDED'` (cancelamento de inscrição ou
   * torneio cancelado). Não entram em `ranking`, não contam em
   * `totalEntries` e não geram receita — `unregisterEntry` devolve
   * `buyIn + fee (+ staffBonus)` e decrementa o `prizePool`.
   */
  refundedEntries: number;

  /** Quantas entradas pagaram o bônus de staff. Base de `staffBonusRevenue`. */
  staffBonusesPaid: number;

  /**
   * Mesas do torneio, INCLUINDO as fechadas ao longo da desmontagem: é
   * histórico ("quantas mesas o clube montou"), não estado corrente.
   * `0` em torneios anteriores ao MVP de mesas.
   */
  tablesUsed: number;

  /** Maior nível de blind alcançado pelo relógio; `null` se o relógio nunca rodou. */
  lastLevelNumber: number | null;

  /** Prize pool efetivamente arrecadado (`buyIn × totalEntries`, já líquido de cancelamentos). */
  prizePool: MoneyString;

  /** Σ dos `prizeAmount` creditados na Wallet. */
  totalPaidOut: MoneyString;

  /**
   * `prizePool - totalPaidOut`. Deveria ser `0.00` num torneio bem fechado;
   * sobra positiva denuncia grade de premiação incompleta (percentuais que
   * não somam 100%) ou faixa premiada sem colocação registrada.
   */
  unpaidPrizePool: MoneyString;

  /** Prêmio garantido anunciado (`Tournament.guaranteedPrize`); `null` se o torneio não tinha garantia. */
  guaranteedPrize: MoneyString | null;

  /**
   * `max(0, guaranteedPrize - prizePool)` — o quanto a casa teria de cobrir
   * para honrar a garantia. `null` quando não há `guaranteedPrize`.
   *
   * CAMPO INFORMATIVO. O pagamento em `TournamentService.finishTournament`
   * hoje distribui apenas `prizePool × percentage` e IGNORA
   * `guaranteedPrize`: um overlay maior que zero significa que os jogadores
   * receberam menos do que o anunciado. Lacuna real e conhecida, deixada
   * exposta de propósito por este relatório e NÃO corrigida por esta feature
   * — mudar o payout é decisão financeira própria (afeta torneios já pagos).
   */
  overlay: MoneyString | null;

  /**
   * `fee × totalEntries`. `buyIn`/`fee`/`staffBonusCost` são imutáveis depois
   * da primeira inscrição, então a receita é calculável por multiplicação,
   * sem histórico de valor por entrada.
   */
  feeRevenue: MoneyString;

  /** `staffBonusCost × staffBonusesPaid`. */
  staffBonusRevenue: MoneyString;

  /** `feeRevenue + staffBonusRevenue`. O buy-in nunca entra: ele é dos jogadores. */
  houseRevenue: MoneyString;

  /**
   * Início REAL do torneio em ISO 8601 UTC (`Tournament.startedAt`), em
   * contraste com `TournamentReportResponse.startsAt`, que é o AGENDADO.
   * `null` em torneios anteriores a `RT-DB-01` (sem backfill deliberado) e
   * em torneios cancelados antes de começar.
   */
  startedAt: string | null;

  /** Encerramento em ISO 8601 UTC; `null` se o torneio nunca foi encerrado. */
  finishedAt: string | null;

  /**
   * `finishedAt - (startedAt ?? startsAt)` em milissegundos; `null` quando
   * falta `finishedAt`. Ver `durationEstimated` antes de exibir como fato.
   */
  durationMs: number | null;

  /**
   * `true` quando `startedAt` é `null` e a duração foi medida a partir de
   * `startsAt` (o horário AGENDADO) — torneio anterior a `RT-DB-01` ou
   * cancelado antes de começar. Nesse caso `durationMs` é uma ESTIMATIVA e a
   * tela deve rotulá-la como tal: um torneio que atrasou 40 min para começar
   * apareceria 40 min mais longo do que foi.
   */
  durationEstimated: boolean;
}

/**
 * Relatório de fechamento de um torneio encerrado.
 *
 * Disponível apenas para `FINISHED` e `CANCELLED` (`RT-002`) e apenas para
 * ADMIN do clube (`RT-003`), porque o payload carrega a economia da casa
 * (`feeRevenue`, `staffBonusRevenue`, `overlay`) — não é dado de jogador.
 *
 * É um documento DERIVADO, recalculado a cada requisição: não existe model
 * `TournamentReport` no banco (`RT-000`). Criar um snapshot introduziria uma
 * segunda fonte de verdade para dinheiro já pago.
 */
export interface TournamentReportResponse {
  tournamentId: string;

  name: string;

  status: TournamentStatus;

  buyIn: MoneyString;

  fee: MoneyString;

  staffBonusCost: MoneyString | null;

  /** Horário AGENDADO em ISO 8601 UTC. O início real é `stats.startedAt`. */
  startsAt: string;

  stats: TournamentReportStatsDto;

  /** Grade de premiação configurada, em `position` ascendente. */
  prizes: TournamentPrizeDto[];

  /**
   * Ranking final em `position` ascendente. Contém uma linha por INSCRIÇÃO
   * não reembolsada (uma reentrada aparece duas vezes com o mesmo `userId`,
   * marcada por `isReentry`); inscrições `REFUNDED` ficam de fora.
   */
  ranking: TournamentReportRankingItemDto[];

  /** Instante em que o relatório foi calculado, em ISO 8601 UTC. */
  generatedAt: string;
}
