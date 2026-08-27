import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

/**
 * PATCH parcial de um nível da grade DESTE torneio. Os limites espelham o
 * CHECK `tournament_blind_levels_blinds_valid` (MT-DB-05) para o erro chegar
 * como 400 legível, e não como violação de constraint. A regra de conjunto
 * `bigBlind >= smallBlind` fica no service: depende do valor que já está
 * gravado quando só um dos dois é enviado.
 */
export class UpdateBlindLevelDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  smallBlind?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bigBlind?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  ante?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  durationSeconds?: number;
}
