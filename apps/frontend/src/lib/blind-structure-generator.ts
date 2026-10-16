/**
 * Geração automática de uma grade de blinds, usada pelo botão "Gerar" de
 * `BlindStructureManager`. Só preenche o editor manual já existente — o
 * admin ainda revisa/ajusta linha a linha antes de salvar (nada aqui chama a
 * API diretamente).
 *
 * Toda a lógica é pura (sem I/O) de propósito: fácil de testar em unidade e
 * de reaproveitar caso um dia vire preview no backend.
 */

/** Mesmo shape de `LevelRow` em `blind-structure-manager.tsx` — strings porque alimentam `<input>`. */
export interface GeneratedLevelRow {
  smallBlind: string;
  bigBlind: string;
  ante: string;
  durationSeconds: string;
  isBreak: boolean;
  breakLabel: string;
}

/**
 * Degraus de ficha "redondos" (convenção padrão de casa de poker — mesma
 * lógica de um rack físico de fichas). Os valores gerados são sempre
 * arredondados PARA CIMA até o degrau mais próximo nesta lista: evita blind
 * como "347" que ninguém consegue apostar com as fichas que tem na mesa.
 */
export const NICE_CHIP_STEPS = [
  25, 50, 75, 100, 150, 200, 300, 400, 500, 600, 800, 1000, 1500, 2000, 3000, 4000, 5000, 6000,
  8000, 10000, 15000, 20000, 30000, 40000, 50000, 60000, 80000, 100000, 150000, 200000, 300000,
  400000, 500000, 600000, 800000, 1000000,
];

/** Arredonda para cima até o próximo degrau da lista (nunca abaixo do pedido). */
function roundUpToNiceChip(value: number): number {
  for (const step of NICE_CHIP_STEPS) {
    if (step >= value) return step;
  }
  return NICE_CHIP_STEPS[NICE_CHIP_STEPS.length - 1];
}

/**
 * Deriva o Nº DE NÍVEIS a partir da duração total desejada — usado quando o
 * admin prefere dizer "quero cada nível com X minutos" e deixar o total de
 * níveis implícito. Aproxima o ciclo (nível + pausa amortizada) porque o
 * número exato de pausas depende do próprio resultado (cadeia circular); erro
 * de ±1 nível aqui é inofensivo — o admin revisa a grade antes de salvar.
 */
export function deriveLevelCount(params: {
  totalDurationMinutes: number;
  levelDurationMinutes: number;
  breakEveryLevels: number | null;
  breakDurationMinutes: number;
}): number {
  const { totalDurationMinutes, levelDurationMinutes, breakEveryLevels, breakDurationMinutes } =
    params;

  if (!breakEveryLevels || breakEveryLevels <= 0) {
    return Math.max(1, Math.round(totalDurationMinutes / levelDurationMinutes));
  }

  const cycleMinutes = breakEveryLevels * levelDurationMinutes + breakDurationMinutes;
  const cycles = totalDurationMinutes / cycleMinutes;
  return Math.max(1, Math.round(cycles * breakEveryLevels));
}

/**
 * Caminho inverso de `deriveLevelCount`: o admin diz quantos níveis quer e a
 * duração de cada um é o que sobra do tempo total depois de descontar as
 * pausas.
 */
export function deriveLevelDurationMinutes(params: {
  totalDurationMinutes: number;
  numLevels: number;
  breakEveryLevels: number | null;
  breakDurationMinutes: number;
}): number {
  const { totalDurationMinutes, numLevels, breakEveryLevels, breakDurationMinutes } = params;

  const breaks =
    breakEveryLevels && breakEveryLevels > 0 ? Math.floor((numLevels - 1) / breakEveryLevels) : 0;
  const playMinutes = totalDurationMinutes - breaks * breakDurationMinutes;

  return Math.max(1, Math.round(playMinutes / numLevels));
}

export interface GenerateBlindLevelsParams {
  numLevels: number;
  levelDurationMinutes: number;
  /** Fichas iniciais de cada jogador — baliza o big blind do nível 1 (~100 BBs, convenção comum de torneio). */
  startingStack: number;
  /** Só usado para projetar o blind FINAL (ver docblock abaixo) — não entra na grade. */
  estimatedPlayers: number;
  /** `null`/`0` = sem pausas. */
  breakEveryLevels: number | null;
  breakDurationMinutes: number;
  includeAntes: boolean;
  /** 1-based — nível a partir do qual o ante passa a existir. Ignorado se `includeAntes` for `false`. */
  anteFromLevel: number;
}

/**
 * Gera a grade completa (níveis + pausas) já no formato do editor manual.
 *
 * CURVA DE CRESCIMENTO DOS BLINDS
 * O big blind do nível 1 nasce de `startingStack / 100` (um stack inicial de
 * 100 big blinds é o padrão de torneio). O ALVO do último nível é
 * `totalChips / (estimatedPlayers * 2)` — quando a média de fichas por
 * jogador ainda vivo cobre uns 2 big blinds, é tipicamente quando um torneio
 * "normal" está terminando. Entre o primeiro e o último nível, o big blind
 * cresce em PROGRESSÃO GEOMÉTRICA (mesmo fator de multiplicação a cada
 * nível) — é a curva que toda estrutura de torneio comercial usa, em vez de
 * incrementos lineares que ficam suaves demais no início e abruptos no fim.
 * Cada valor calculado é arredondado para cima até o degrau de ficha mais
 * próximo (`roundUpToNiceChip`) e NUNCA regride em relação ao nível anterior
 * (o arredondamento poderia, em tese, empatar ou "descer" por causa de como
 * os degraus estão espaçados).
 *
 * PAUSAS herdam os blinds do nível anterior — mesma convenção do editor
 * manual (`nextRow` em blind-structure-manager.tsx): o `CHECK` do banco exige
 * blinds positivos em toda linha, intervalo incluso.
 */
export function generateBlindLevels(params: GenerateBlindLevelsParams): GeneratedLevelRow[] {
  const {
    numLevels,
    levelDurationMinutes,
    startingStack,
    estimatedPlayers,
    breakEveryLevels,
    breakDurationMinutes,
    includeAntes,
    anteFromLevel,
  } = params;

  const totalChips = startingStack * estimatedPlayers;
  const firstBigBlind = roundUpToNiceChip(Math.max(25, startingStack / 100));
  const targetFinalBigBlind = Math.max(
    firstBigBlind * 2,
    totalChips / Math.max(2, estimatedPlayers * 2),
  );
  const growth =
    numLevels > 1 ? Math.pow(targetFinalBigBlind / firstBigBlind, 1 / (numLevels - 1)) : 1;

  const rows: GeneratedLevelRow[] = [];
  let previousBigBlind = 0;
  let previousSmallBlind = 0;
  let previousAnte = 0;

  for (let level = 1; level <= numLevels; level += 1) {
    let bigBlind = roundUpToNiceChip(firstBigBlind * Math.pow(growth, level - 1));
    if (bigBlind < previousBigBlind) bigBlind = previousBigBlind;
    let smallBlind = roundUpToNiceChip(bigBlind / 2);
    if (smallBlind > bigBlind) smallBlind = bigBlind;
    const ante = includeAntes && level >= anteFromLevel ? roundUpToNiceChip(bigBlind * 0.12) : 0;

    rows.push({
      smallBlind: String(smallBlind),
      bigBlind: String(bigBlind),
      ante: String(ante),
      durationSeconds: String(levelDurationMinutes * 60),
      isBreak: false,
      breakLabel: '',
    });

    previousBigBlind = bigBlind;
    previousSmallBlind = smallBlind;
    previousAnte = ante;

    const isLastLevel = level === numLevels;
    if (
      breakEveryLevels &&
      breakEveryLevels > 0 &&
      level % breakEveryLevels === 0 &&
      !isLastLevel
    ) {
      rows.push({
        smallBlind: String(previousSmallBlind),
        bigBlind: String(previousBigBlind),
        ante: String(previousAnte),
        durationSeconds: String(breakDurationMinutes * 60),
        isBreak: true,
        breakLabel: `Intervalo · ${breakDurationMinutes} min`,
      });
    }
  }

  return rows;
}
