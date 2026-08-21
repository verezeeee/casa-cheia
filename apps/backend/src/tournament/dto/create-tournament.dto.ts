import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsInt,
  IsISO8601,
  IsOptional,
  Matches,
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
   * Grade de premiação completa. A soma dos `percentage` precisa fechar
   * exatamente 100.00 — validado no service (regra sobre o CONJUNTO de
   * linhas, um `@Matches` de campo único não expressa isso).
   */
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TournamentPrizeInputDto)
  prizes!: TournamentPrizeInputDto[];
}
