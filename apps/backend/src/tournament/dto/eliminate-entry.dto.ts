import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

export class EliminateEntryDto {
  /**
   * Colocação final do jogador eliminado (1 = campeão). Opcional: o admin
   * pode registrar a eliminação primeiro e a colocação depois, ou nunca —
   * `finishTournament` só exige colocação preenchida para as posições
   * premiadas.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  finalPosition?: number;
}
