import { Type } from 'class-transformer';
import { IsInt, Matches, Min } from 'class-validator';

const PERCENTAGE_PATTERN = /^\d+(\.\d{1,2})?$/;

export class TournamentPrizeInputDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  position!: number;

  @Matches(PERCENTAGE_PATTERN, {
    message: 'percentage deve ser um decimal, ex: "40.00".',
  })
  percentage!: string;
}
