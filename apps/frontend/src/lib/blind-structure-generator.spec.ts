import {
  deriveLevelCount,
  deriveLevelDurationMinutes,
  generateBlindLevels,
  NICE_CHIP_STEPS,
} from './blind-structure-generator';

describe('blind-structure-generator', () => {
  describe('deriveLevelCount / deriveLevelDurationMinutes', () => {
    it('deriva o número de níveis sem pausas', () => {
      expect(
        deriveLevelCount({
          totalDurationMinutes: 240,
          levelDurationMinutes: 20,
          breakEveryLevels: null,
          breakDurationMinutes: 15,
        }),
      ).toBe(12);
    });

    it('deriva o número de níveis descontando pausas periódicas', () => {
      // 6 níveis de 20min (120) + 1 pausa de 15min a cada 6 níveis = ciclo de 135min
      const result = deriveLevelCount({
        totalDurationMinutes: 270, // ~2 ciclos
        levelDurationMinutes: 20,
        breakEveryLevels: 6,
        breakDurationMinutes: 15,
      });
      expect(result).toBeGreaterThan(10);
      expect(result).toBeLessThan(14);
    });

    it('é o inverso aproximado de deriveLevelDurationMinutes', () => {
      const duration = deriveLevelDurationMinutes({
        totalDurationMinutes: 240,
        numLevels: 12,
        breakEveryLevels: 6,
        breakDurationMinutes: 15,
      });
      // 12 níveis, 1 pausa (após o nível 6) de 15min: (240 - 15) / 12 ≈ 18.75 → 19
      expect(duration).toBe(19);
    });

    it('nunca deriva menos que 1 nível/minuto mesmo com parâmetros absurdos', () => {
      expect(
        deriveLevelCount({
          totalDurationMinutes: 1,
          levelDurationMinutes: 1000,
          breakEveryLevels: null,
          breakDurationMinutes: 15,
        }),
      ).toBeGreaterThanOrEqual(1);
      expect(
        deriveLevelDurationMinutes({
          totalDurationMinutes: 1,
          numLevels: 1000,
          breakEveryLevels: null,
          breakDurationMinutes: 15,
        }),
      ).toBeGreaterThanOrEqual(1);
    });
  });

  describe('generateBlindLevels', () => {
    const BASE_PARAMS = {
      numLevels: 10,
      levelDurationMinutes: 20,
      startingStack: 10_000,
      estimatedPlayers: 20,
      breakEveryLevels: null as number | null,
      breakDurationMinutes: 15,
      includeAntes: false,
      anteFromLevel: 1,
    };

    it('gera o número certo de níveis, todos como jogo (sem pausa)', () => {
      const rows = generateBlindLevels(BASE_PARAMS);
      expect(rows).toHaveLength(10);
      expect(rows.every((r) => !r.isBreak)).toBe(true);
    });

    it('todo valor de blind cai num degrau de ficha "redondo"', () => {
      const rows = generateBlindLevels(BASE_PARAMS);
      for (const row of rows) {
        expect(NICE_CHIP_STEPS).toContain(Number(row.smallBlind));
        expect(NICE_CHIP_STEPS).toContain(Number(row.bigBlind));
      }
    });

    it('os blinds nunca diminuem de um nível para o próximo', () => {
      const rows = generateBlindLevels(BASE_PARAMS);
      for (let i = 1; i < rows.length; i += 1) {
        expect(Number(rows[i].bigBlind)).toBeGreaterThanOrEqual(Number(rows[i - 1].bigBlind));
        expect(Number(rows[i].smallBlind)).toBeGreaterThanOrEqual(Number(rows[i - 1].smallBlind));
      }
    });

    it('bigBlind nunca é menor que smallBlind em nenhum nível (CHECK do banco)', () => {
      const rows = generateBlindLevels(BASE_PARAMS);
      for (const row of rows) {
        expect(Number(row.bigBlind)).toBeGreaterThanOrEqual(Number(row.smallBlind));
      }
    });

    it('o primeiro big blind fica perto de stack/100 (100 big blinds iniciais)', () => {
      const rows = generateBlindLevels(BASE_PARAMS);
      // stack 10_000 / 100 = 100, que já é um degrau exato
      expect(Number(rows[0].bigBlind)).toBe(100);
    });

    it('arredonda pra cima quando stack/100 cai entre dois degraus', () => {
      // 12_000 / 100 = 120 → não é degrau; o próximo acima é 150
      const rows = generateBlindLevels({ ...BASE_PARAMS, startingStack: 12_000 });
      expect(Number(rows[0].bigBlind)).toBe(150);
    });

    it('sem antes configurados, todo nível tem ante "0"', () => {
      const rows = generateBlindLevels(BASE_PARAMS);
      expect(rows.every((r) => r.ante === '0')).toBe(true);
    });

    it('com antes a partir do nível 3, os 2 primeiros ficam sem e o resto com ante > 0', () => {
      const rows = generateBlindLevels({ ...BASE_PARAMS, includeAntes: true, anteFromLevel: 3 });
      expect(rows[0].ante).toBe('0');
      expect(rows[1].ante).toBe('0');
      expect(Number(rows[2].ante)).toBeGreaterThan(0);
      expect(Number(rows[rows.length - 1].ante)).toBeGreaterThan(0);
    });

    it('insere pausa a cada N níveis, herdando os blinds do nível anterior, e nunca após o último', () => {
      const rows = generateBlindLevels({ ...BASE_PARAMS, numLevels: 7, breakEveryLevels: 3 });
      // jogo, jogo, jogo, PAUSA, jogo, jogo, jogo, PAUSA, jogo
      const breakIndexes = rows.flatMap((r, i) => (r.isBreak ? [i] : []));
      expect(breakIndexes).toEqual([3, 7]);
      expect(rows[rows.length - 1].isBreak).toBe(false); // nunca termina em pausa

      const beforeBreak = rows[2];
      const breakRow = rows[3];
      expect(breakRow.smallBlind).toBe(beforeBreak.smallBlind);
      expect(breakRow.bigBlind).toBe(beforeBreak.bigBlind);
      expect(breakRow.breakLabel).toBe('Intervalo · 15 min');
      expect(breakRow.durationSeconds).toBe(String(15 * 60));
    });

    it('sem breakEveryLevels, não insere nenhuma pausa', () => {
      const rows = generateBlindLevels({ ...BASE_PARAMS, breakEveryLevels: 0 });
      expect(rows.every((r) => !r.isBreak)).toBe(true);
    });

    it('cada nível de jogo usa a duração informada, em segundos', () => {
      const rows = generateBlindLevels({ ...BASE_PARAMS, levelDurationMinutes: 25 });
      expect(rows.filter((r) => !r.isBreak).every((r) => r.durationSeconds === '1500')).toBe(true);
    });

    it('com 1 único nível, não quebra (sem crescimento a calcular)', () => {
      const rows = generateBlindLevels({ ...BASE_PARAMS, numLevels: 1 });
      expect(rows).toHaveLength(1);
      expect(Number(rows[0].bigBlind)).toBeGreaterThan(0);
    });
  });
});
