/**
 * Um nível da estrutura de blinds.
 *
 * Todos os valores são `number`, não `MoneyString`: blind de torneio é
 * contagem de FICHAS, exatamente como `TournamentEntryDto.chipStack`. Não tem
 * casas decimais nem lastro monetário — contraste deliberado com
 * `TableSummaryDto.smallBlind`, que é dinheiro real de cash game.
 */
export interface BlindLevelDto {
  /** Ordem do nível (1-based, sem buracos). */
  levelNumber: number;

  /** Fichas (não dinheiro). */
  smallBlind: number;

  /** Fichas (não dinheiro). */
  bigBlind: number;

  /** Fichas; `0` quando o nível não cobra ante. */
  ante: number;

  durationSeconds: number;

  /** `true` quando o nível é um intervalo — os blinds não valem nesse período. */
  isBreak: boolean;

  /** Rótulo do intervalo ("Intervalo · 15 min"); `null` fora de um break. */
  breakLabel: string | null;
}
