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

export class CreateTournamentDto {
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  /** Parte do buy-in que compõe o prize pool. */
  @Matches(DECIMAL_PATTERN, {
    message: 'buyIn deve ser um decimal monetário, ex: "90.00".',
  })
  buyIn!: string;

  /** Taxa da casa, cobrada junto com o buyIn mas fora do prize pool. */
  @Matches(DECIMAL_PATTERN, {
    message: 'fee deve ser um decimal monetário, ex: "10.00".',
  })
  fee!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  startingStack!: number;

  @Type(() => Number)
  @IsInt()
  @Min(2)
  maxPlayers!: number;

  @IsISO8601()
  startsAt!: string;

  @IsOptional()
  @IsISO8601()
  lateRegUntil?: string;

  @IsOptional()
  @Matches(DECIMAL_PATTERN, {
    message: 'guaranteedPrize deve ser um decimal monetário.',
  })
  guaranteedPrize?: string;

  /**
   * Preset de blinds a COPIAR para dentro do torneio (MT-BE-03). Os níveis são
   * duplicados na criação: editar o preset depois não altera este torneio.
   * Ausente = torneio sem relógio de blinds (retrocompatível).
   */
  @IsOptional()
  @IsUUID()
  blindStructureId?: string;

  /**
   * Capacidade das mesas abertas por este torneio. Default 9 aplicado no
   * service (e não como valor inicial da propriedade) porque o default de
   * classe depende de `exposeDefaultValues` do class-transformer — `?? 9` no
   * service é uma linha e não depende de configuração do pipe.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(10)
  tableCapacity?: number;

  /** Reentry (MT-BE-09). `false` = freezeout, o comportamento anterior. */
  @IsOptional()
  @IsBoolean()
  allowReentry?: boolean;

  /** Quantas REENTRADAS por jogador (fora a inscrição original). Nulo = ilimitado. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxReentries?: number;

  /** Último nível de blind em que ainda se pode reentrar. Nulo = sem corte. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  reentryUntilLevel?: number;

  /**
   * Bônus de staff (staff add-on). OPCIONAL por jogador na inscrição — quem
   * paga leva `staffBonusChips` fichas extras; o valor bypassa o prize pool
   * como `fee`. Precisa vir junto de `staffBonusChips` (validado no service,
   * `assertCoherentStaffBonusConfig`) — ausente = torneio não oferece.
   */
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
   * Grade de premiação completa. A soma dos `percentage` precisa fechar
   * exatamente 100.00 — validado no service (regra sobre o CONJUNTO de
   * linhas, um `@Matches` de campo único não expressa isso).
   */
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TournamentPrizeInputDto)
  prizes!: TournamentPrizeInputDto[];
}
