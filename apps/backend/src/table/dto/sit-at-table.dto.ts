import { Type } from 'class-transformer';
import { IsInt, Matches, Max, Min } from 'class-validator';

const DECIMAL_PATTERN = /^\d+(\.\d{1,2})?$/;

export class SitAtTableDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  seatNumber!: number;

  @Matches(DECIMAL_PATTERN, {
    message: 'buyInAmount deve ser um decimal monetário, ex: "100.00".',
  })
  buyInAmount!: string;
}
