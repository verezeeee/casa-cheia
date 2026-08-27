import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Um nível do preset de blinds. Valores em FICHAS (`Int`), nunca dinheiro —
 * ver a nota de tipo em `BlindLevel` (tournament.prisma).
 *
 * Os pisos aqui espelham o `CHECK` de `blind_levels` (MT-DB-05):
 * `small_blind > 0 AND big_blind >= small_blind AND ante >= 0 AND
 * duration_seconds > 0`. `bigBlind >= smallBlind` é regra entre dois campos e
 * fica no service, junto com as demais validações de conjunto.
 *
 * Nível de intervalo (`isBreak`) TAMBÉM exige blinds > 0: o `CHECK` vale para
 * toda linha, e a convenção do clube é repetir os blinds do nível anterior.
 */
export class BlindLevelInputDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  levelNumber!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  smallBlind!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  bigBlind!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  ante?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  durationSeconds!: number;

  @IsOptional()
  @IsBoolean()
  isBreak?: boolean;

  /** Obrigatório quando `isBreak` — validado no service. */
  @IsOptional()
  @MinLength(1)
  @MaxLength(120)
  breakLabel?: string;
}
