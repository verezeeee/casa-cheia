import { IsBoolean, IsOptional } from 'class-validator';

export class RegisterEntryDto {
  /**
   * Opção pelo bônus de staff (`Tournament.staffBonusCost`/`staffBonusChips`).
   * Ausente/`false` = não paga. `true` num torneio sem bônus configurado é
   * 400 no service (`registerEntry`), não aqui — depende de estado do banco,
   * não é validável só com o corpo da requisição.
   */
  @IsOptional()
  @IsBoolean()
  staffBonus?: boolean;
}
