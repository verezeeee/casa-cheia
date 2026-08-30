import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsBoolean,
  IsInt,
  IsISO8601,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  Min,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { TournamentPrizeInputDto } from './tournament-prize-input.dto';

const DECIMAL_PATTERN = /^\d+(\.\d{1,2})?$/;

/**
 * `PATCH .../torneios/:id` — espelha `CreateTournamentDto` campo a campo,
 * TODOS opcionais: campo ausente não muda, campo presente vira o novo valor
 * (semântica de PATCH, igual `UpdateBlindLevelDto`). O service
 * (`TournamentService.updateTournament`) só aceita a edição enquanto
 * `status === 'REGISTERING'` e ninguém se inscreveu ainda — a validação de
 * COERÊNCIA entre campos (reentry, bônus de staff) é feita lá, contra o
 * estado JÁ GRAVADO mesclado com este patch, não contra este DTO isolado.
 */
export class UpdateTournamentDto {
  @IsOptional()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  /** Parte do buy-in que compõe o prize pool. */
  @IsOptional()
  @Matches(DECIMAL_PATTERN, {
    message: 'buyIn deve ser um decimal monetário, ex: "90.00".',
  })
  buyIn?: string;

  /** Taxa da casa, cobrada junto com o buyIn mas fora do prize pool. */
  @IsOptional()
  @Matches(DECIMAL_PATTERN, {
    message: 'fee deve ser um decimal monetário, ex: "10.00".',
  })
  fee?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  startingStack?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  maxPlayers?: number;

  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @IsOptional()
  @IsISO8601()
  lateRegUntil?: string;

  @IsOptional()
  @Matches(DECIMAL_PATTERN, {
    message: 'guaranteedPrize deve ser um decimal monetário.',
  })
  guaranteedPrize?: string;

  /**
   * TROCA o preset de origem e RECOPIA os níveis (substitui os
   * `TournamentBlindLevel` existentes) — exige `clockStatus === 'NOT_STARTED'`
   * no service. Não dá para "remover" a estrutura por aqui (ausente = não
   * mexe); só troca de um preset para outro.
   */
  @IsOptional()
  @IsUUID()
  blindStructureId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(10)
  tableCapacity?: number;

  /** Reentry (MT-BE-09). */
  @IsOptional()
  @IsBoolean()
  allowReentry?: boolean;

  /** Quantas REENTRADAS por jogador (fora a inscrição original). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxReentries?: number;

  /** Último nível de blind em que ainda se pode reentrar. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  reentryUntilLevel?: number;

  /** Bônus de staff — precisa vir junto de `staffBonusChips`. */
  @IsOptional()
  @Matches(DECIMAL_PATTERN, {
    message: 'staffBonusCost deve ser um decimal monetário, ex: "5.00".',
  })
  staffBonusCost?: string;

  /** Fichas extras concedidas a quem paga o bônus de staff. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  staffBonusChips?: number;

  /**
   * Grade de premiação completa — SUBSTITUI a grade inteira quando presente
   * (mesmo espírito do `PUT` de `BlindStructureService.update`: não existe
   * edição parcial de uma faixa isolada). A soma dos `percentage` precisa
   * fechar 100.00 — validado no service.
   */
  @IsOptional()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TournamentPrizeInputDto)
  prizes?: TournamentPrizeInputDto[];
}
