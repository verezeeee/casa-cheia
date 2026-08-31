import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { TableType } from '../../generated/prisma';

const DECIMAL_PATTERN = /^\d+(\.\d{1,2})?$/;

export class CreateTableDto {
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @IsEnum(TableType)
  type!: TableType;

  @Matches(DECIMAL_PATTERN, {
    message: 'smallBlind deve ser um decimal monetário, ex: "1.00".',
  })
  smallBlind!: string;

  @Matches(DECIMAL_PATTERN, {
    message: 'bigBlind deve ser um decimal monetário, ex: "2.00".',
  })
  bigBlind!: string;

  @Matches(DECIMAL_PATTERN, {
    message: 'minBuyIn deve ser um decimal monetário, ex: "40.00".',
  })
  minBuyIn!: string;

  @Matches(DECIMAL_PATTERN, {
    message: 'maxBuyIn deve ser um decimal monetário, ex: "200.00".',
  })
  maxBuyIn!: string;

  /** Espelha o `CHECK (max_seats BETWEEN 2 AND 10)` — validado aqui para um 400 amigável em vez do erro cru do banco. */
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(10)
  maxSeats!: number;

  @IsOptional()
  @Matches(DECIMAL_PATTERN, {
    message: 'rakePercent deve ser um decimal, ex: "5.00".',
  })
  rakePercent?: string;
}
