import type { BlindLevelDto, BlindStructureDto } from '@poker-system/shared';
import type { BlindLevel, BlindStructure } from '../generated/prisma';

/**
 * Aceita `BlindLevel` (preset) e também `TournamentBlindLevel` (cópia por
 * valor) — os campos são idênticos de propósito, ver tournament.prisma.
 */
export function toBlindLevelDto(
  level: Omit<BlindLevel, 'id' | 'blindStructureId'>,
): BlindLevelDto {
  return {
    levelNumber: level.levelNumber,
    smallBlind: level.smallBlind,
    bigBlind: level.bigBlind,
    ante: level.ante,
    durationSeconds: level.durationSeconds,
    isBreak: level.isBreak,
    breakLabel: level.breakLabel,
  };
}

/** Espera `levels` já ordenados por `levelNumber` (o service faz o `orderBy`). */
export function toBlindStructureDto(
  structure: BlindStructure & { levels: BlindLevel[] },
): BlindStructureDto {
  return {
    id: structure.id,
    name: structure.name,
    levels: structure.levels.map(toBlindLevelDto),
  };
}
