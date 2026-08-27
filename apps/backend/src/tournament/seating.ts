import { randomInt } from 'node:crypto';

/**
 * MT-BE-02 — Algoritmo de assentos de torneio, como FUNÇÃO PURA.
 *
 * Zero import de Prisma, zero I/O, zero `Date.now()`: tudo entra por parâmetro
 * e tudo sai por retorno. É deliberado — esta é a peça de maior risco do épico
 * (PRD §10) e a única testável exaustivamente sem Postgres. O e2e de
 * concorrência (`MT-QA-01`) cobre transacionalidade; a CORREÇÃO da regra é
 * responsabilidade exclusiva deste arquivo e do seu `seating.spec.ts`.
 *
 * ---------------------------------------------------------------------------
 * POLÍTICA `MT-001` (decidida em 22/08/2026, ver `mesas-torneio-mvp-tasks.md`)
 * ---------------------------------------------------------------------------
 * 1. ORIGEM do jogador movido: sempre a mesa mais cheia; empate → maior
 *    `tableNumber` (determinístico, sem estado extra).
 * 2. DESTINO: primeiro assento livre por número, não a posição "correta" em
 *    relação ao botão.
 *    // ponytail: primeiro-livre, não a posição relativa ao botão — se o clube
 *    // reclamar de assento ruim pós-move, revisar.
 * 3. SEM limite de trocas por jogador.
 *    // ponytail: sem anti-igreja (não mover quem acabou de mover), adicionar
 *    // se virar reclamação real.
 * 4. QUEBRA quando `jogadoresVivos <= (mesasAbertas - 1) * capacidade`; quebra
 *    a mesa de MAIOR `tableNumber` entre as MENOS ocupadas.
 * 5. Roda a cada eliminação, mas só produz `Move[]` quando a diferença de
 *    ocupação excede 1 — na maioria das eliminações é no-op.
 *
 * ---------------------------------------------------------------------------
 * DECISÕES DE BORDA (não cobertas por `MT-001`, tomadas aqui e documentadas)
 * ---------------------------------------------------------------------------
 * a) DESEMPATE ÚNICO EM TODA ESCOLHA DE MESA: maior `tableNumber`, inclusive
 *    para o DESTINO de um move e para o assento inicial. `MT-001` só fixou o
 *    desempate da origem e da quebra ("mesmo desempate, por consistência") —
 *    estendemos a mesma regra ao destino para não haver dois critérios.
 * b) QUAL jogador sai da mesa mais cheia: o do MAIOR `seatNumber` ocupado.
 *    `MT-001` não diz, e sem modelo de botão não existe "o próximo big blind".
 *    Critério estável e reproduzível, que é o que o teste exige.
 * c) "SÓ RESTA 1 JOGADOR NUMA MESA E NENHUMA OUTRA TEM VAGA": `planRebalance`
 *    devolve `[]`. Não movemos ninguém para um assento inexistente e não
 *    inventamos mesa nova em rebalanceamento — abrir mesa é exclusividade de
 *    `planInitialSeat` (inscrição). O desequilíbrio persiste até alguém ser
 *    eliminado, o que é o comportamento correto: só acontece com capacidades
 *    heterogêneas e todas as demais mesas lotadas.
 * d) NO MÁXIMO UMA QUEBRA POR CHAMADA. O gatilho é cruzado por UMA eliminação,
 *    e uma quebra por chamada garante que nenhum jogador é movido duas vezes
 *    dentro do mesmo plano (o que exigiria do chamador aplicar `Move`s em
 *    cadeia sobre a mesma entry). Estado folgado o bastante para duas quebras
 *    só nasce de importação/redraw; a chamada seguinte resolve.
 * e) `planRebalance` NÃO fecha mesa — só devolve `Move[]`. O chamador
 *    (`MT-BE-05`) fecha toda mesa que ficou sem assento ativo. Mesa vazia sem
 *    moves (todos já eliminados) também é fechada por ele.
 * f) O CHAMADOR já liberou o assento do eliminado antes de chamar: o snapshot
 *    recebido reflete o estado PÓS-eliminação.
 * g) `capacity` é POR MESA (o schema permite heterogeneidade: final table de 8
 *    convivendo com mesas de 9). Por isso o gatilho da quebra é implementado
 *    na forma geral `vivos <= capacidadeDasMesasRemanescentes`, que se reduz a
 *    `(mesasAbertas - 1) * capacidade` quando todas têm a mesma capacidade.
 *
 * // ponytail: quebrar e reabrir mesa "bate" perto do limiar quando ainda há
 * // inscrição aberta (5/5 → elimina → 9/0 quebra → inscreve → 9/1 → 5/5).
 * // Aceitável no MVP: em torneio real o late registration fecha antes das
 * // quebras. Se incomodar, exigir `status = RUNNING` para quebrar.
 */

/** Uma inscrição sentada. `entryId` é o id da `TournamentEntry`, não do user. */
export interface SeatedEntry {
  readonly entryId: string;
  readonly seatNumber: number;
}

/**
 * Snapshot de uma mesa do torneio. Um único shape para as três funções — a
 * alternativa (um tipo "só ocupação" para `planInitialSeat` e outro com
 * `entryId` para `planRebalance`) seria duas hierarquias para o mesmo dado.
 *
 * Mesas `CLOSED` DEVEM vir na lista com `isOpen: false` e `seats: []`: elas não
 * recebem ninguém, mas seus números continuam reservados. Omiti-las faria
 * `planInitialSeat` reciclar um `tableNumber` já usado e colidir com
 * `@@unique([tournamentId, tableNumber])` em todo retry.
 */
export interface TableSnapshot {
  readonly tableNumber: number;
  readonly capacity: number;
  readonly isOpen: boolean;
  readonly seats: readonly SeatedEntry[];
}

/** Onde sentar um jogador que está entrando (inscrição inicial ou reentry). */
export interface InitialSeatPlan {
  readonly tableNumber: number;
  readonly seatNumber: number;
  /** `true` ⇒ o chamador precisa criar a `TournamentTable` na MESMA transação. */
  readonly openNewTable: boolean;
  /**
   * Capacidade da mesa escolhida — a `defaultCapacity` quando ela vai ser
   * aberta agora, a capacidade já gravada quando ela existe. Evita que o
   * chamador tenha que decidir de novo o que passar no `create`.
   */
  readonly capacity: number;
}

/**
 * Uma realocação. Vira, no chamador, DUAS escritas na mesma transação:
 * desativar o assento atual e inserir a linha nova (ledger append-only).
 * `reason` são literais idênticos a `TournamentSeatReason` do Prisma/shared —
 * literal em vez do enum importado pelo mesmo motivo que o resto do service
 * usa `status: 'REGISTERED'`: o enum de `@poker-system/shared` não é
 * atribuível ao union gerado pelo Prisma sem cast.
 */
export interface Move {
  readonly entryId: string;
  readonly fromTable: number;
  readonly fromSeat: number;
  readonly toTable: number;
  readonly toSeat: number;
  readonly reason: 'BALANCE' | 'BREAK';
}

/** Assento sorteado por `planRedraw`. */
export interface SeatAssignment {
  readonly entryId: string;
  readonly tableNumber: number;
  readonly seatNumber: number;
}

export interface RebalancePolicy {
  /**
   * Diferença de ocupação tolerada entre a mesa mais cheia e a mais vazia
   * antes de mover alguém (`MT-001` item 5 ⇒ 1). Valores < 1 são elevados a 1:
   * com 0 o algoritmo oscilaria eternamente (3/2 → 2/3 → 3/2 ...).
   */
  readonly maxOccupancyGap: number;
}

/** A política de `MT-001`. É o default de `planRebalance`. */
export const MT001_POLICY: RebalancePolicy = { maxOccupancyGap: 1 };

/** Cópia mutável usada só durante o planejamento (o input é `readonly`). */
interface WorkingTable {
  readonly tableNumber: number;
  readonly capacity: number;
  seats: SeatedEntry[];
}

/** Mais cheia primeiro; empate → maior `tableNumber` (`MT-001` item 1). */
function byFullness(a: WorkingTable, b: WorkingTable): number {
  return b.seats.length - a.seats.length || b.tableNumber - a.tableNumber;
}

/** Mais vazia primeiro; empate → maior `tableNumber` (`MT-001` item 4 + (a)). */
function byEmptiness(a: WorkingTable, b: WorkingTable): number {
  return a.seats.length - b.seats.length || b.tableNumber - a.tableNumber;
}

function hasFreeSeat(table: WorkingTable): boolean {
  return table.seats.length < table.capacity;
}

/**
 * Primeiro assento livre por número (`MT-001` item 2). Assume mesa com vaga —
 * todos os chamadores filtram por `hasFreeSeat` antes. Sem vaga devolveria
 * `capacity + 1`, e é por isso que não há `throw` aqui: um ramo morto a menos.
 */
function firstFreeSeat(table: WorkingTable): number {
  const taken = new Set(table.seats.map((seat) => seat.seatNumber));
  let seatNumber = 1;
  while (taken.has(seatNumber)) {
    seatNumber += 1;
  }
  return seatNumber;
}

function toWorkingTables(tables: readonly TableSnapshot[]): WorkingTable[] {
  return tables
    .filter((table) => table.isOpen)
    .map((table) => ({
      tableNumber: table.tableNumber,
      capacity: table.capacity,
      seats: [...table.seats],
    }));
}

/**
 * Tira o jogador do maior assento ocupado da origem (decisão (b)) e o senta no
 * primeiro assento livre do destino, MUTANDO o estado de planejamento. É essa
 * mutação que garante a invariante "nenhum `Move` mira um (mesa, assento) já
 * mirado por outro": o assento vira ocupado no mesmo instante em que é
 * escolhido.
 */
function relocate(
  from: WorkingTable,
  to: WorkingTable,
  reason: Move['reason'],
): Move {
  const player = [...from.seats].sort((a, b) => b.seatNumber - a.seatNumber)[0];
  from.seats = from.seats.filter((seat) => seat.entryId !== player.entryId);
  const toSeat = firstFreeSeat(to);
  to.seats.push({ entryId: player.entryId, seatNumber: toSeat });
  return {
    entryId: player.entryId,
    fromTable: from.tableNumber,
    fromSeat: player.seatNumber,
    toTable: to.tableNumber,
    toSeat,
    reason,
  };
}

/**
 * Onde sentar um jogador que entra agora — inscrição inicial OU reentry em
 * torneio já em andamento (`MT-BE-09`): o critério é o mesmo, "a mesa mais
 * vazia com vaga".
 *
 * Sem nenhuma mesa com vaga, abre a próxima (`maior tableNumber + 1`, contando
 * também as fechadas) no assento 1. É o único ponto do arquivo que abre mesa.
 *
 * ATENÇÃO À INVARIANTE: sozinho, este planejador NÃO garante
 * `max - min <= 1` — o 10º inscrito numa mesa de 9 abre a mesa 2 e o estado
 * fica 9/1 por construção (não há como equalizar sem MOVER quem já sentou, e
 * mover é `planRebalance`). A invariante é propriedade da COMPOSIÇÃO
 * `planInitialSeat` + `planRebalance`, e é assim que o teste de propriedade a
 * verifica.
 */
export function planInitialSeat(
  tables: readonly TableSnapshot[],
  defaultCapacity: number,
): InitialSeatPlan {
  const candidates = toWorkingTables(tables)
    .filter(hasFreeSeat)
    .sort(byEmptiness);

  if (candidates.length === 0) {
    const highest = tables.reduce(
      (max, table) => Math.max(max, table.tableNumber),
      0,
    );
    return {
      tableNumber: highest + 1,
      seatNumber: 1,
      openNewTable: true,
      capacity: defaultCapacity,
    };
  }

  const target = candidates[0];
  return {
    tableNumber: target.tableNumber,
    seatNumber: firstFreeSeat(target),
    openNewTable: false,
    capacity: target.capacity,
  };
}

/**
 * Plano de realocações após uma eliminação (o snapshot já vem sem o eliminado
 * — decisão (f)). Duas fases, nesta ordem:
 *
 *   1. QUEBRA (`MT-001` item 4): se a mesa menos ocupada couber inteira nas
 *      demais, todo mundo dela sai com `reason = BREAK` e ela fica vazia — o
 *      chamador a fecha. No máximo uma quebra por chamada (decisão (d)).
 *   2. EQUILÍBRIO (`MT-001` itens 1, 2 e 5): enquanto
 *      `ocupação(mais cheia) - ocupação(mais vazia com vaga) > maxOccupancyGap`,
 *      move um jogador com `reason = BALANCE`. Com gap ≤ 1 devolve `[]`, que é
 *      o caso da esmagadora maioria das eliminações.
 *
 * Termina sempre: a quebra roda no máximo uma vez e cada `BALANCE` reduz
 * estritamente a soma dos quadrados das ocupações.
 */
export function planRebalance(
  tables: readonly TableSnapshot[],
  policy: RebalancePolicy = MT001_POLICY,
): Move[] {
  let open = toWorkingTables(tables);
  // 0 ou 1 mesa aberta: não há para onde mover nem o que quebrar (quebrar a
  // única mesa deixaria o torneio sem mesa).
  if (open.length < 2) {
    return [];
  }

  const moves: Move[] = [];

  // --- Fase 1: quebra de mesa ---
  const alive = open.reduce((total, table) => total + table.seats.length, 0);
  const doomed = [...open].sort(byEmptiness)[0];
  const survivors = open.filter((table) => table !== doomed);
  const survivorsCapacity = survivors.reduce(
    (total, table) => total + table.capacity,
    0,
  );
  if (alive <= survivorsCapacity) {
    // A aritmética acima garante vaga para TODOS os jogadores da mesa
    // quebrada: livres = survivorsCapacity - (alive - doomed) >= doomed.
    while (doomed.seats.length > 0) {
      const target = survivors.filter(hasFreeSeat).sort(byEmptiness)[0];
      moves.push(relocate(doomed, target, 'BREAK'));
    }
    open = survivors;
  }

  // --- Fase 2: equilíbrio ---
  const maxGap = Math.max(1, policy.maxOccupancyGap);
  for (;;) {
    const source = [...open].sort(byFullness)[0];
    const targets = open
      .filter((table) => table !== source && hasFreeSeat(table))
      .sort(byEmptiness);
    // Decisão (c): ninguém tem vaga ⇒ para por aqui, sem abrir mesa.
    if (targets.length === 0) {
      break;
    }
    const target = targets[0];
    if (source.seats.length - target.seats.length <= maxGap) {
      break;
    }
    moves.push(relocate(source, target, 'BALANCE'));
  }

  return moves;
}

/** PRNG determinístico (mulberry32) — só existe para o `seed` de `planRedraw`. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Redraw total (`MT-BE-06`): sorteia TODOS os vivos em mesas novas de
 * `capacity`. O número de mesas é o mínimo necessário (`ceil(n / capacity)`) e
 * a distribuição é round-robin sobre a lista embaralhada — o que dá
 * `max - min <= 1` por construção, sem precisar de rebalanceamento depois.
 *
 * `seed` opcional para o teste ser determinístico; sem ele o embaralhamento
 * usa `crypto.randomInt` (o único ponto não-determinístico do arquivo, e ele
 * não faz I/O). As mesas são numeradas de 1 a N: o chamador é quem decide
 * reaproveitar `TournamentTable`s abertas ou abrir novas.
 */
export function planRedraw(
  entryIds: readonly string[],
  capacity: number,
  seed?: number,
): SeatAssignment[] {
  if (capacity < 1) {
    throw new RangeError('capacity precisa ser >= 1 para o redraw.');
  }
  if (entryIds.length === 0) {
    return [];
  }

  const next = seed === undefined ? undefined : mulberry32(seed);
  const random = (bound: number) =>
    next === undefined ? randomInt(bound) : Math.floor(next() * bound);

  const shuffled = [...entryIds];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = random(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const tableCount = Math.ceil(shuffled.length / capacity);
  return shuffled.map((entryId, index) => ({
    entryId,
    tableNumber: (index % tableCount) + 1,
    seatNumber: Math.floor(index / tableCount) + 1,
  }));
}
